import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { newId } from "../domain/id";
import {
    normalizeSuggestedBaseUnit,
    type ReceiptApplyInput,
    type ReceiptApplyLineInput,
    receiptApplyLineResultSchema,
    receiptApplyLineSchema,
    receiptDetailDtoSchema,
} from "../domain/receipt";
import type { ReceiptLineWrite } from "../repositories/receiptRepository";
import {
    insertReceipt,
    listReceiptLines,
    saveReceiptParseResult,
    setReceiptLineMatch,
} from "../repositories/receiptRepository";
import {
    buildApplyInput,
    createReviewRows,
    patchReviewRow,
    patchReviewRowNewItem,
    type ReceiptReviewRow,
    receiptApplyIdempotencyKey,
} from "../routes/_app/_inventory/receipts/new/-functions/receipt-review-form";
import { createItem, getItem } from "./itemService";
import { createLocation } from "./locationService";
import { listPriceRecords } from "./priceService";
import {
    applyReceipt,
    getReceipt,
    ReceiptServiceError,
} from "./receiptService";

// 0001_seed_base_categories.sql が投入するルートカテゴリ
const foodCategoryId = "019fdcef-ee16-70fb-a3a0-5c5837f334db";

/**
 * 解析済み（status = parsed）のレシートを 1 枚作る。実際の解析は AI と R2 を
 * 使うため、反映のテストでは repository へ直接書いて同じ状態を作る。
 * 明細は既定値へ差分を上書きする形で受け取り、検証したい列だけ指定できるようにする。
 */
// biome-ignore lint/suspicious/noExportsInTest: 反映のテストは後続の課題でも同じ下ごしらえを使うため、ヘルパだけは共有できる形で置く
export const createTestReceipt = async (
    db: D1Database,
    lines: readonly Partial<ReceiptLineWrite>[],
    options: { storeName?: string } = {},
): Promise<{ receiptId: string; lineIds: string[] }> => {
    const receiptId = newId();
    await insertReceipt(db, {
        id: receiptId,
        objectKey: `receipts/${receiptId}.jpg`,
        contentType: "image/jpeg",
        byteSize: 1024,
    });
    // 表記辞書と店舗マスタは他のテストと共有されるため、名前は毎回変える
    const suffix = crypto.randomUUID();
    await saveReceiptParseResult(db, receiptId, {
        storeName: options.storeName ?? `テスト店-${suffix}`,
        purchasedAt: "2026-08-20T00:00:00.000Z",
        totalPrice: null,
        model: "test-model",
        lines: lines.map((line, index) => ({
            lineNo: index + 1,
            rawName: `テスト商品-${suffix}-${index + 1}`,
            completedName: null,
            normalizedName: `てすとしょうひん-${suffix}-${index + 1}`,
            quantity: 1,
            price: null,
            printedExpiryDate: null,
            estimatedExpiryDate: null,
            expirySource: "unknown",
            expiryConfidence: null,
            expiryReason: null,
            stockRelevant: true,
            suggestedCategoryId: null,
            suggestedCategoryName: null,
            suggestedBaseUnit: null,
            suggestedBaseDimension: null,
            ...line,
        })),
    });
    const rows = await listReceiptLines(db, receiptId);
    return { receiptId, lineIds: rows.map((row) => row.id) };
};

/** 明細 1 行だけのレシート。行 ID は反映入力の lineId に要る。 */
const createSingleLineReceipt = async (
    line: Partial<ReceiptLineWrite>,
): Promise<{ receiptId: string; lineId: string }> => {
    const { receiptId, lineIds } = await createTestReceipt(env.DB, [line]);
    const lineId = lineIds[0];
    if (lineId === undefined) {
        throw new Error("receipt line was not created");
    }
    return { receiptId, lineId };
};

/** 保管場所は品目ごとに要る。名前の衝突を避けるため毎回作る。 */
const createTestLocation = async (): Promise<string> => {
    const location = await createLocation(env.DB, {
        name: `テスト置き場-${crypto.randomUUID()}`,
    });
    return location.id;
};

/** 既存品目への加算を試すための品目。基準単位と次元だけがテストの関心事。 */
const createTestItem = async (input: {
    baseUnit: string;
    baseDimension: "mass" | "volume" | "count";
}): Promise<string> => {
    const item = await createItem(env.DB, {
        name: `テスト品目-${crypto.randomUUID()}`,
        categoryId: foodCategoryId,
        locationId: await createTestLocation(),
        baseUnit: input.baseUnit,
        baseDimension: input.baseDimension,
    });
    return item.id;
};

// 反映は明細を 1 つずつ確かめれば足りるため、1 行ぶんの入力だけを受け取る。
// idempotencyKey は共有 DB で衝突させないよう毎回変える
const applySingleLine = async (
    receiptId: string,
    line: ReceiptApplyLineInput,
) =>
    applyReceipt(
        env.DB,
        receiptId,
        {
            idempotencyKey: `test-apply-${crypto.randomUUID()}`,
            lines: [line],
        },
        env,
    );

const firstPriceRecord = async (itemId: string) => {
    const page = await listPriceRecords(env, { itemId });
    return page.items;
};

describe("applyReceipt の価格履歴", () => {
    it("新規作成した質量の品目でも、明細の数量を内容量として価格を記録する", async () => {
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 1000,
            price: 298,
            suggestedBaseUnit: "g",
            suggestedBaseDimension: "mass",
        });

        const result = await applySingleLine(receiptId, {
            lineId,
            action: "create_item",
            newItem: {
                name: `小麦粉-${crypto.randomUUID()}`,
                categoryId: foodCategoryId,
                locationId: await createTestLocation(),
                baseUnit: "g",
                baseDimension: "mass",
            },
            registerAlias: false,
        });

        const applied = result.lines[0];
        if (applied === undefined || applied.itemId === null) {
            throw new Error("apply result did not contain the line");
        }
        expect(applied.priceRecorded).toBe(true);
        const records = await firstPriceRecord(applied.itemId);
        expect(records).toHaveLength(1);
        const record = records[0];
        if (record === undefined) {
            throw new Error("price record was not written");
        }
        expect(record).toMatchObject({
            contentAmount: 1000,
            setCount: 1,
            price: 298,
        });
        // 1kg・298 円は 29.8 円/100g。総量が変わらないため単価の比較は保てる
        // （単価は割り算で導くため、浮動小数の誤差を許して比べる）
        expect(record.unitPrice).toBeCloseTo(29.8, 6);
    });

    it("既存の容量の品目へ加算する行も価格を記録する", async () => {
        const itemId = await createTestItem({
            baseUnit: "mL",
            baseDimension: "volume",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 1000,
            price: 200,
            suggestedBaseUnit: "mL",
            suggestedBaseDimension: "volume",
        });

        const result = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            registerAlias: false,
        });

        expect(result.lines[0]?.priceRecorded).toBe(true);
        const records = await firstPriceRecord(itemId);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            contentAmount: 1000,
            setCount: 1,
            price: 200,
            unitPrice: 20,
        });
    });

    // 解析の既定プロンプトが長く「ml」を指示していたため、レシート経由で作られた
    // 容量の品目の基準単位は "mL" ではなく "ml" で保存されている。単位表を
    // 大小文字を区別して引くと、この現実の経路だけ価格を記録できない
    it("基準単位が ml の容量の品目でも価格を記録する", async () => {
        const itemId = await createTestItem({
            baseUnit: "ml",
            baseDimension: "volume",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 1000,
            price: 200,
            suggestedBaseUnit: "ml",
            suggestedBaseDimension: "volume",
        });

        const result = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            registerAlias: false,
        });

        expect(result.lines[0]?.priceRecorded).toBe(true);
        const records = await firstPriceRecord(itemId);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            contentAmount: 1000,
            setCount: 1,
            price: 200,
            unitPrice: 20,
        });
    });

    // 表記が揺れた品目と表記の揃った明細が混ざる組み合わせ。数量の換算
    // （resolveLineQuantity）も同じ単位表を引くため、ここも大小文字に左右される
    it("品目が ml、明細が L でも数量を換算して価格を記録する", async () => {
        const itemId = await createTestItem({
            baseUnit: "ml",
            baseDimension: "volume",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 2,
            price: 400,
            suggestedBaseUnit: "L",
            suggestedBaseDimension: "volume",
        });

        const result = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            registerAlias: false,
        });

        const applied = result.lines[0];
        expect(applied?.priceRecorded).toBe(true);
        expect(applied?.quantity).toBe(2000);
        const records = await firstPriceRecord(itemId);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            contentAmount: 2000,
            setCount: 1,
            price: 400,
            unitPrice: 20,
        });
    });

    it("数量ベースの品目は従来どおり内容量 1 × セット数で記録する", async () => {
        const itemId = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 20,
            price: 400,
            suggestedBaseUnit: "個",
            suggestedBaseDimension: "count",
        });

        const result = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            registerAlias: false,
        });

        expect(result.lines[0]?.priceRecorded).toBe(true);
        const records = await firstPriceRecord(itemId);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            contentAmount: 1,
            setCount: 20,
            price: 400,
            unitPrice: 20,
        });
    });

    it("明示した内容量の単位が基準単位へ換算できない行は記録しない", async () => {
        const itemId = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 3,
            price: 500,
            suggestedBaseUnit: "個",
            suggestedBaseDimension: "count",
        });

        const result = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            contentAmount: 3,
            contentUnit: "kg",
            registerAlias: false,
        });

        // 明示指定は黙って読み替えない。単価を誤らせるより欠測にする
        expect(result.lines[0]?.priceRecorded).toBe(false);
        expect(await firstPriceRecord(itemId)).toHaveLength(0);
    });

    it("金額のない行は記録しない", async () => {
        const itemId = await createTestItem({
            baseUnit: "g",
            baseDimension: "mass",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 500,
            price: null,
            suggestedBaseUnit: "g",
            suggestedBaseDimension: "mass",
        });

        const result = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            registerAlias: false,
        });

        expect(result.lines[0]?.priceRecorded).toBe(false);
        expect(await firstPriceRecord(itemId)).toHaveLength(0);
    });

    it("次元と基準単位が噛み合わない品目は記録しない", async () => {
        // 単位表に無い「袋」を質量として数える品目。数量をそのまま内容量にすると
        // 円/100g と表示されるのに中身は袋数、という行が残ってしまう
        const itemId = await createTestItem({
            baseUnit: "袋",
            baseDimension: "mass",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 3,
            price: 500,
            suggestedBaseUnit: "袋",
            suggestedBaseDimension: "mass",
        });

        const result = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            registerAlias: false,
        });

        expect(result.lines[0]?.priceRecorded).toBe(false);
        expect(await firstPriceRecord(itemId)).toHaveLength(0);
    });
});

describe("applyReceipt の数量換算", () => {
    it("数量を指定しない行はレシートの単位から品目の単位へ換算する", async () => {
        const itemId = await createTestItem({
            baseUnit: "L",
            baseDimension: "volume",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 2000,
            price: 400,
            suggestedBaseUnit: "mL",
            suggestedBaseDimension: "volume",
        });

        const result = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            registerAlias: false,
        });

        // 2000 mL は 2 L。在庫も価格も品目の単位で記録される
        expect(result.lines[0]?.quantity).toBe(2);
        const records = await firstPriceRecord(itemId);
        expect(records).toHaveLength(1);
        // 単価は最小単位（mL）を基準に出すため 400 円 / 2000 mL = 20 円/100mL
        expect(records[0]).toMatchObject({
            contentAmount: 2,
            setCount: 1,
            unitPrice: 20,
        });
    });

    it("確認画面で数量を書き換えた行は品目の単位での入力として扱う", async () => {
        const itemId = await createTestItem({
            baseUnit: "L",
            baseDimension: "volume",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 2000,
            price: 400,
            suggestedBaseUnit: "mL",
            suggestedBaseDimension: "volume",
        });

        const result = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            // mL として換算されるなら 1.5 L となり反映が止まる。止まらないことが
            // 「明示した数量は換算しない」の裏取りになる
            quantity: 1500,
            registerAlias: false,
        });

        expect(result.lines[0]?.quantity).toBe(1500);
        const records = await firstPriceRecord(itemId);
        expect(records[0]).toMatchObject({ contentAmount: 1500, setCount: 1 });
    });

    it("換算すると上限を超える行は、実績を残さずに反映を止める", async () => {
        // 解析が「1.5kg」を quantity 1500 / kg と返すだけで届く経路。上限超えの
        // 数量が applied_quantity に残ると、開き直した確認画面が数量の検証で
        // 送信を止め、反映を開始したレシートは削除もできないまま詰む
        const itemId = await createTestItem({
            baseUnit: "mL",
            baseDimension: "volume",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 2000,
            price: 400,
            suggestedBaseUnit: "L",
            suggestedBaseDimension: "volume",
        });

        await expect(
            applySingleLine(receiptId, {
                lineId,
                action: "add_to_item",
                itemId,
                registerAlias: false,
            }),
        ).rejects.toThrow(ReceiptServiceError);

        const stopped = await getReceipt(env, receiptId);
        expect(stopped.lines[0]?.applied).toBeNull();
        expect((await getItem(env.DB, itemId)).currentQuantity).toBe(0);

        // 実績が残っていないため、数量を品目の単位で指定し直せば反映できる
        const retried = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            quantity: 2000,
            registerAlias: false,
        });
        expect(retried.lines[0]?.quantity).toBe(2000);
    });

    it("単位が同じでも上限を超える数量は反映しない", async () => {
        // 換算を通らない行にも同じ上限が要る。解析の数量に上限は無い
        const itemId = await createTestItem({
            baseUnit: "g",
            baseDimension: "mass",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 2_000_000,
            price: 500,
            suggestedBaseUnit: "g",
            suggestedBaseDimension: "mass",
        });

        await expect(
            applySingleLine(receiptId, {
                lineId,
                action: "add_to_item",
                itemId,
                registerAlias: false,
            }),
        ).rejects.toThrow(ReceiptServiceError);

        const stopped = await getReceipt(env, receiptId);
        expect(stopped.lines[0]?.applied).toBeNull();
        expect((await getItem(env.DB, itemId)).currentQuantity).toBe(0);
    });

    it("量の種類が違う行は反映を止める", async () => {
        const itemId = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 300,
            price: 250,
            suggestedBaseUnit: "g",
            suggestedBaseDimension: "mass",
        });

        await expect(
            applySingleLine(receiptId, {
                lineId,
                action: "add_to_item",
                itemId,
                registerAlias: false,
            }),
        ).rejects.toThrow(ReceiptServiceError);
        expect(await firstPriceRecord(itemId)).toHaveLength(0);
    });

    it("換算できない単位の組み合わせでも数量を明示すれば反映できる", async () => {
        // 量の種類が違うレシートは品目へそのまま足せない。確認画面が
        // 「数量を品目の単位に直して指定してください」の指示どおりの入力を
        // 明示送信できれば反映できる。
        const itemId = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const line = {
            quantity: 500,
            price: 200,
            suggestedBaseUnit: "g",
            suggestedBaseDimension: "mass",
        } as const;
        const withoutQuantity = await createSingleLineReceipt(line);

        await expect(
            applySingleLine(withoutQuantity.receiptId, {
                lineId: withoutQuantity.lineId,
                action: "add_to_item",
                itemId,
                registerAlias: false,
            }),
        ).rejects.toThrow(ReceiptServiceError);

        // 解析値と同じ数でも、明示して送れば換算を通らずそのまま反映される
        const withQuantity = await createSingleLineReceipt(line);
        const result = await applySingleLine(withQuantity.receiptId, {
            lineId: withQuantity.lineId,
            action: "add_to_item",
            itemId,
            quantity: 500,
            registerAlias: false,
        });

        expect(result.lines[0]?.quantity).toBe(500);
    });
});

describe("applyReceipt の反映実績", () => {
    it("反映した数量・単位・金額・期限を明細へ記録する", async () => {
        const itemId = await createTestItem({
            baseUnit: "L",
            baseDimension: "volume",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 2000,
            price: 400,
            suggestedBaseUnit: "mL",
            suggestedBaseDimension: "volume",
        });

        const result = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            // 確認画面での書き換えを模す。記録されるのは解析値ではなくこちら
            price: 380,
            expiryDate: "2026-09-01",
            registerAlias: false,
        });

        // 詳細ページと確認画面はこの schema で応答を parse するため、
        // 反映実績を載せた形が契約に収まっていることをここで確かめる
        receiptDetailDtoSchema.parse(result.receipt);
        const line = result.receipt.lines[0];
        if (line === undefined) {
            throw new Error("applied receipt did not contain the line");
        }
        expect(line.applied).toEqual({
            action: "add_to_item",
            // 2000 mL は品目の単位では 2 L。数量と単位は対で残さないと読めない
            quantity: 2,
            baseUnit: "L",
            price: 380,
            // ロットの ISO 8601 UTC ではなく、確認画面と同じ日付で残す
            expiryDate: "2026-09-01",
            appliedAt: result.receipt.appliedAt,
        });
        // 解析値は紙との突き合わせに要るため、書き換えられずに残る
        expect(line.quantity).toBe(2000);
        expect(line.price).toBe(400);
        expect(result.receipt.appliedTotalPrice).toBe(380);
    });

    it("取り込まなかった行は skip として記録し、数量も金額も持たせない", async () => {
        const itemId = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const { receiptId, lineIds } = await createTestReceipt(env.DB, [
            {
                quantity: 2,
                price: 300,
                suggestedBaseUnit: "個",
                suggestedBaseDimension: "count",
            },
            // レジ袋のように在庫へ置かない行
            { quantity: 1, price: 5, stockRelevant: false },
        ]);
        const [stockedLineId, skippedLineId] = lineIds;
        if (stockedLineId === undefined || skippedLineId === undefined) {
            throw new Error("receipt lines were not created");
        }

        const result = await applyReceipt(
            env.DB,
            receiptId,
            {
                idempotencyKey: `test-apply-${crypto.randomUUID()}`,
                lines: [
                    {
                        lineId: stockedLineId,
                        action: "add_to_item",
                        itemId,
                        registerAlias: false,
                    },
                    { lineId: skippedLineId, action: "skip" },
                ],
            },
            env,
        );

        expect(result.receipt.lines[1]?.applied).toEqual({
            action: "skip",
            quantity: null,
            baseUnit: null,
            price: null,
            expiryDate: null,
            appliedAt: result.receipt.appliedAt,
        });
        // 取り込まなかった行の金額は「記録した額」に含めない
        expect(result.receipt.appliedTotalPrice).toBe(300);
    });

    it("反映済みの行は、送り直しても最初に記録した内容を保つ", async () => {
        const itemId = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 3,
            price: 300,
            suggestedBaseUnit: "個",
            suggestedBaseDimension: "count",
        });

        const first = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            registerAlias: false,
        });
        const firstApplied = first.receipt.lines[0]?.applied;
        expect(firstApplied).toMatchObject({ quantity: 3, price: 300 });

        const second = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            // 在庫は既に動いているため、この金額はどこにも届かない。数量まで
            // 変えると在庫側が「別の操作」として 409 を返し、記録の上書きを
            // 試す前に反映が止まってしまうため、同じ数量で送り直す
            price: 999,
            registerAlias: false,
        });

        expect(second.lines[0]?.replayed).toBe(true);
        // 記録は「実際に動いた反映」のもの。再送の入力で塗り替えない
        expect(second.receipt.lines[0]?.applied).toEqual(firstApplied);
    });

    it("在庫が動いた行を取り込まないへ変えても、反映済みの実績を結果に返す", async () => {
        // 実績はリポジトリのガードが守るため在庫は動かないが、結果が skip 成功だと
        // 完了画面が「取り込みませんでした」と表示し、報告と在庫が食い違う
        const itemId = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 3,
            price: 300,
            suggestedBaseUnit: "個",
            suggestedBaseDimension: "count",
        });

        const first = await applySingleLine(receiptId, {
            lineId,
            action: "add_to_item",
            itemId,
            registerAlias: false,
        });
        const firstApplied = first.receipt.lines[0]?.applied;
        expect(firstApplied).toMatchObject({ quantity: 3 });

        const second = await applySingleLine(receiptId, {
            lineId,
            action: "skip",
            registerAlias: false,
        });

        expect(second.lines[0]).toMatchObject({
            action: "add_to_item",
            itemId,
            quantity: 3,
            replayed: true,
        });
        // 組み立てた結果は HTTP / MCP の契約をそのまま通る形でなければならない
        expect(() =>
            receiptApplyLineResultSchema.parse(second.lines[0]),
        ).not.toThrow();
        expect(second.receipt.lines[0]?.applied).toEqual(firstApplied);
        expect((await getItem(env.DB, itemId)).currentQuantity).toBe(3);
    });
});

describe("normalizeSuggestedBaseUnit", () => {
    // 提案はそのまま新規品目の基準単位になるため、保存の時点で綴りを揃えないと
    // 価格を換算できない品目が作られ続ける
    it("単位表にある表記へ寄せる", () => {
        expect(normalizeSuggestedBaseUnit("ml")).toBe("mL");
        expect(normalizeSuggestedBaseUnit("ML")).toBe("mL");
        expect(normalizeSuggestedBaseUnit("l")).toBe("L");
        expect(normalizeSuggestedBaseUnit("G")).toBe("g");
        expect(normalizeSuggestedBaseUnit("KG")).toBe("kg");
    });

    it("単位表に無い表記と既に揃っている表記はそのまま返す", () => {
        for (const unit of ["袋", "パック", "個", "本", "mL", "L", "g", ""]) {
            expect(normalizeSuggestedBaseUnit(unit)).toBe(unit);
        }
    });
});

describe("receiptApplyLineSchema の内容量指定", () => {
    const baseLine = {
        lineId: "line-1",
        action: "add_to_item",
        itemId: "item-1",
    };

    it("contentUnit だけの指定を拒む", () => {
        // 片方向の検証だけだと単位が黙って捨てられ、品目の基準単位で
        // 価格が記録されてしまう
        const result = receiptApplyLineSchema.safeParse({
            ...baseLine,
            contentUnit: "kg",
        });
        expect(result.success).toBe(false);
    });

    it("contentAmount だけの指定も拒む", () => {
        const result = receiptApplyLineSchema.safeParse({
            ...baseLine,
            contentAmount: 500,
        });
        expect(result.success).toBe(false);
    });

    it("対で指定した行と、どちらも省いた行は受け付ける", () => {
        expect(
            receiptApplyLineSchema.safeParse({
                ...baseLine,
                contentAmount: 500,
                contentUnit: "g",
            }).success,
        ).toBe(true);
        expect(receiptApplyLineSchema.safeParse(baseLine).success).toBe(true);
    });
});

/**
 * 確認画面（routes 配下の純粋関数）から service までを通しで動かす。
 * 単位の正規化と数量の明示送信はそれぞれ別に直されたが、実際の詰まり方は
 * 「画面が組んだ入力を反映へ渡す」境目で起きるため、その境目を跨いで固定する。
 */
describe("確認画面から反映までの通し", () => {
    /**
     * 画面が受け取る明細 DTO は手書きせず getReceipt から取る。DTO を literal で
     * 書くと契約の変更に追随せず、通っているつもりのまま腐る。
     */
    const buildScreenInput = async (
        receiptId: string,
        edit: (rows: readonly ReceiptReviewRow[]) => ReceiptReviewRow[],
    ): Promise<ReceiptApplyInput> => {
        const detail = await getReceipt(env, receiptId);
        const built = buildApplyInput({
            idempotencyKey: receiptApplyIdempotencyKey(receiptId),
            receiptStoreName: detail.storeName,
            purchaseRecorded: detail.purchaseId !== null,
            storeNameInput: "",
            note: "",
            rows: edit(createReviewRows(detail.lines)),
        });
        if (!built.ok) {
            throw new Error(
                `確認画面が反映入力を組めなかった: ${JSON.stringify(built.issues)}`,
            );
        }
        return built.input;
    };

    it("解析値が ml、品目が mL の行を、数量を触らずに反映できる", async () => {
        const itemId = await createTestItem({
            baseUnit: "mL",
            baseDimension: "volume",
        });
        // 保存時の正規化が入る前に作られた行を模す。repository へ直接書くため
        // toLineWrites の normalizeSuggestedBaseUnit を通らず "ml" のまま残る
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 1000,
            price: 200,
            suggestedBaseUnit: "ml",
            suggestedBaseDimension: "volume",
        });

        const input = await buildScreenInput(receiptId, (rows) =>
            // 利用者は反映先を選ぶだけで、数量欄には触らない
            patchReviewRow(rows, lineId, { action: "add_to_item", itemId }),
        );
        // 数量を送らない行だけがサーバー側の換算を通る。ここで quantity が
        // 混じると、換算が壊れていても通ってしまい検証にならない
        expect(input.lines[0]).not.toHaveProperty("quantity");

        const result = await applyReceipt(env.DB, receiptId, input, env);

        expect(result.lines[0]?.quantity).toBe(1000);
        // 大小文字を畳まないと単位表を引けず、価格も記録されない
        expect(result.lines[0]?.priceRecorded).toBe(true);
        expect(result.receipt.lines[0]?.applied).toMatchObject({
            quantity: 1000,
            baseUnit: "mL",
        });
    });

    it("同じ個数の次元なら単位表記が違っても自動で反映する", async () => {
        const { receiptId, lineId } = await createSingleLineReceipt({
            quantity: 3,
            price: 240,
            suggestedBaseUnit: "個",
            suggestedBaseDimension: "count",
        });
        const locationId = await createTestLocation();
        const input = await buildScreenInput(receiptId, (rows) =>
            patchReviewRowNewItem(
                patchReviewRow(rows, lineId, { action: "create_item" }),
                lineId,
                {
                    baseUnit: "袋",
                    categoryId: foodCategoryId,
                    locationId,
                },
            ),
        );
        const result = await applyReceipt(env.DB, receiptId, input, env);

        expect(result.lines[0]).toMatchObject({
            itemCreated: true,
            quantity: 3,
        });
        expect(result.receipt.status).toBe("applied");
        const itemId = result.lines[0]?.itemId;
        if (itemId === null || itemId === undefined) {
            throw new Error("created item was not returned");
        }
        expect((await getItem(env.DB, itemId)).baseUnit).toBe("袋");
        expect((await getItem(env.DB, itemId)).currentQuantity).toBe(3);
    });

    it("量の種類が違う行は止め、数量を明示すれば部分反映を完了できる", async () => {
        const volumeItemId = await createTestItem({
            baseUnit: "mL",
            baseDimension: "volume",
        });
        const bagItemId = await createTestItem({
            baseUnit: "袋",
            baseDimension: "count",
        });
        const { receiptId, lineIds } = await createTestReceipt(env.DB, [
            {
                quantity: 500,
                price: 150,
                suggestedBaseUnit: "mL",
                suggestedBaseDimension: "volume",
            },
            {
                quantity: 3,
                price: 240,
                suggestedBaseUnit: "g",
                suggestedBaseDimension: "mass",
            },
        ]);
        const [convertibleLineId, incompatibleLineId] = lineIds;
        if (
            convertibleLineId === undefined ||
            incompatibleLineId === undefined
        ) {
            throw new Error("receipt lines were not created");
        }
        const chooseItems = (
            rows: readonly ReceiptReviewRow[],
        ): ReceiptReviewRow[] =>
            patchReviewRow(
                patchReviewRow(rows, convertibleLineId, {
                    action: "add_to_item",
                    itemId: volumeItemId,
                }),
                incompatibleLineId,
                { action: "add_to_item", itemId: bagItemId },
            );

        // 量の種類が違うため 2 行目で止まる。1 行目の在庫は動いたまま
        const firstInput = await buildScreenInput(receiptId, chooseItems);
        await expect(
            applyReceipt(env.DB, receiptId, firstInput, env),
        ).rejects.toThrow(ReceiptServiceError);

        // 画面を開き直し、エラー文言の指示どおり品目の単位の数量を明示する
        const retryInput = await buildScreenInput(receiptId, (rows) =>
            patchReviewRow(chooseItems(rows), incompatibleLineId, {
                quantity: "3",
                quantityEdited: true,
            }),
        );
        expect(retryInput.lines[1]).toMatchObject({ quantity: 3 });
        // 反映済みの 1 行目は実績を初期値に戻し、常に数量を明示する。ここが
        // 解析値へ戻ると digest がずれて RECEIPT_APPLY_CONFLICT になる
        expect(retryInput.lines[0]).toMatchObject({ quantity: 500 });

        const second = await applyReceipt(env.DB, receiptId, retryInput, env);

        expect(second.lines[0]?.replayed).toBe(true);
        expect(second.lines[1]?.replayed).toBe(false);
        expect(second.lines[1]?.quantity).toBe(3);
        expect(second.receipt.status).toBe("applied");
    });

    it("取り込まないと決めた行は、開き直して送り直しても在庫へ入らない", async () => {
        const skippedItemId = await createTestItem({
            baseUnit: "g",
            baseDimension: "mass",
        });
        const bagItemId = await createTestItem({
            baseUnit: "袋",
            baseDimension: "count",
        });
        const { receiptId, lineIds } = await createTestReceipt(env.DB, [
            {
                quantity: 500,
                price: 150,
                suggestedBaseUnit: "g",
                suggestedBaseDimension: "mass",
            },
            {
                quantity: 3,
                price: 240,
                suggestedBaseUnit: "g",
                suggestedBaseDimension: "mass",
            },
        ]);
        const [skippedLineId, deadlockLineId] = lineIds;
        if (skippedLineId === undefined || deadlockLineId === undefined) {
            throw new Error("receipt lines were not created");
        }
        // 1 行目は照合済みにする。既定が「既存の品目へ加算」になる行で、
        // 利用者の「取り込まない」が消えると無言で在庫が増える
        await setReceiptLineMatch(env.DB, skippedLineId, {
            matchedItemId: skippedItemId,
            matchMethod: "exact",
            matchScore: 100,
        });

        // 1 行目は取り込まない。量の種類が違うため 2 行目で止まる
        const firstInput = await buildScreenInput(receiptId, (rows) =>
            patchReviewRow(
                patchReviewRow(rows, skippedLineId, { action: "skip" }),
                deadlockLineId,
                { action: "add_to_item", itemId: bagItemId },
            ),
        );
        await expect(
            applyReceipt(env.DB, receiptId, firstInput, env),
        ).rejects.toThrow(ReceiptServiceError);

        // 画面を開き直し、2 行目だけを直して送る
        const retryInput = await buildScreenInput(receiptId, (rows) =>
            patchReviewRow(rows, deadlockLineId, {
                action: "add_to_item",
                itemId: bagItemId,
                quantity: "3",
                quantityEdited: true,
            }),
        );
        expect(retryInput.lines[0]).toMatchObject({ action: "skip" });

        const second = await applyReceipt(env.DB, receiptId, retryInput, env);

        expect(second.lines[0]?.action).toBe("skip");
        expect((await getItem(env.DB, skippedItemId)).currentQuantity).toBe(0);
        expect(second.receipt.status).toBe("applied");
    });
});
