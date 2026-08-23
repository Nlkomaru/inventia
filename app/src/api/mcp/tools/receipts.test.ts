import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newId } from "../../../domain/id";
import {
    type ReceiptApplyLineInput,
    receiptExampleListOutputSchema,
    receiptExampleNamesMax,
} from "../../../domain/receipt";
import { normalizeReceiptName } from "../../../domain/receipt-match";
import {
    insertReceipt,
    listReceiptLines,
    type ReceiptLineWrite,
    saveReceiptParseResult,
} from "../../../repositories/receiptRepository";
import { createItem } from "../../../services/itemService";
import { createLocation } from "../../../services/locationService";
import { applyReceipt } from "../../../services/receiptService";
import {
    createTestMcpClient,
    type TestMcpClient,
    toolErrorText,
    toolResult,
} from "../../../test/mcp-client";

// 0001_seed_base_categories.sql が投入するルートカテゴリ
const foodCategoryId = "019fdcef-ee16-70fb-a3a0-5c5837f334db";
const dailyGoodsCategoryId = "019fdcef-ee13-7178-9c19-2a5bde5c3778";

// レシートを解析する tool は無く、解析そのものは AI と R2 を使うため、
// 取込例の材料は repository へ直接書いて「解析済み」の状態を作り、
// 反映だけは本物の applyReceipt に通す（match_method = 'manual' と
// receipts.applied_at はこの経路でしか書かれない）。検証は MCP 経由で行う。
const createTestItem = async (input: {
    baseUnit: string;
    baseDimension: "mass" | "volume" | "count";
    categoryId?: string;
}) => {
    // 保管場所も品目名も他のテストと共有の DB に入るため、名前は毎回変える
    const location = await createLocation(env.DB, {
        name: `テスト置き場-${crypto.randomUUID()}`,
    });
    return createItem(env.DB, {
        name: `テスト品目-${crypto.randomUUID()}`,
        categoryId: input.categoryId ?? foodCategoryId,
        locationId: location.id,
        baseUnit: input.baseUnit,
        baseDimension: input.baseDimension,
    });
};

type TestLine = Partial<ReceiptLineWrite> & { rawName: string };

/** 解析済み（status = parsed）のレシートを 1 枚作る。照合キーは本物の正規化を通す。 */
const seedReceipt = async (
    lines: readonly TestLine[],
    options: { storeName?: string } = {},
): Promise<{ receiptId: string; lineIds: string[] }> => {
    const receiptId = newId();
    await insertReceipt(env.DB, {
        id: receiptId,
        objectKey: `receipts/${receiptId}.jpg`,
        contentType: "image/jpeg",
        byteSize: 1024,
    });
    await saveReceiptParseResult(env.DB, receiptId, {
        storeName: options.storeName ?? `テスト店-${crypto.randomUUID()}`,
        purchasedAt: "2026-08-20T00:00:00.000Z",
        totalPrice: null,
        model: "test-model",
        lines: lines.map((line, index) => ({
            lineNo: index + 1,
            completedName: null,
            normalizedName: normalizeReceiptName(line.rawName),
            quantity: 1,
            price: 198,
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
    const rows = await listReceiptLines(env.DB, receiptId);
    return { receiptId, lineIds: rows.map((row) => row.id) };
};

const applyLines = async (
    receiptId: string,
    lines: readonly ReceiptApplyLineInput[],
) =>
    applyReceipt(
        env.DB,
        receiptId,
        {
            // 共有 DB で購入が衝突しないよう毎回変える
            idempotencyKey: `test-examples-${crypto.randomUUID()}`,
            lines: [...lines],
        },
        env,
    );

/** 1 行のレシートを作り、その行を品目へ反映して取込例を 1 件残す。 */
const settleLine = async (
    line: TestLine,
    itemId: string,
    options: { storeName?: string } = {},
): Promise<void> => {
    const { receiptId, lineIds } = await seedReceipt([line], options);
    const lineId = lineIds[0];
    if (lineId === undefined) {
        throw new Error("receipt line was not created");
    }
    await applyLines(receiptId, [
        {
            lineId,
            action: "add_to_item",
            itemId,
            // 数量を明示しないとレシートの提案単位から品目の単位へ換算され、
            // 量の種類が違う例（g を提案した行を 個 の品目へ寄せる）が反映できない
            quantity: 1,
            // 辞書は他のテストと共有のため、この検証では登録しない
            registerAlias: false,
        },
    ]);
};

describe("list_receipt_examples", () => {
    let mcp: TestMcpClient;

    beforeEach(async () => {
        mcp = await createTestMcpClient();
    });

    afterEach(async () => {
        await mcp.close();
    });

    const listExamples = async (args: Record<string, unknown>) =>
        receiptExampleListOutputSchema.parse(
            toolResult(await mcp.call("list_receipt_examples", args)),
        );

    it("反映まで終わった明細を、最終的な品目・単位・カテゴリ・店舗つきで返す", async () => {
        const item = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
            categoryId: foodCategoryId,
        });
        const rawName = `たまご10P-${crypto.randomUUID()}`;
        const storeName = `テストスーパー-${crypto.randomUUID()}`;
        await settleLine(
            {
                rawName,
                suggestedBaseUnit: "個",
                suggestedBaseDimension: "count",
                suggestedCategoryId: foodCategoryId,
                suggestedCategoryName: "食料品",
            },
            item.id,
            { storeName },
        );

        const output = await listExamples({ names: [rawName] });

        expect(output.notFound).toEqual([]);
        expect(output.examples).toHaveLength(1);
        expect(output.examples[0]).toMatchObject({
            rawName,
            normalizedName: normalizeReceiptName(rawName),
            itemName: item.name,
            baseUnit: "個",
            baseDimension: "count",
            categoryName: "食料品",
            storeName,
            suggestedBaseUnit: "個",
            suggestedCategoryName: "食料品",
            // 提案どおりの品目になったので、真似すべき訂正ではない
            corrected: false,
        });
    });

    it("反映していないレシートの明細は例に含めない", async () => {
        const rawName = `未反映の商品-${crypto.randomUUID()}`;
        await seedReceipt([{ rawName }]);

        const output = await listExamples({ names: [rawName] });

        expect(output.examples).toEqual([]);
        expect(output.notFound).toEqual([rawName]);
    });

    it("例の無い表記は notFound へ入れ、呼び出し全体は失敗させない", async () => {
        const item = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const settled = `牛乳1L-${crypto.randomUUID()}`;
        const unknown = `一度も買っていない商品-${crypto.randomUUID()}`;
        await settleLine({ rawName: settled }, item.id);

        const output = await listExamples({ names: [settled, unknown] });

        expect(output.examples.map((example) => example.rawName)).toEqual([
            settled,
        ]);
        expect(output.notFound).toEqual([unknown]);
    });

    it("提案と品目が食い違う行は corrected になり、correctedOnly で絞れる", async () => {
        // AI は g（重さ）を提案したが、利用者は 個 で数える日用品へ寄せた
        const correctedItem = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
            categoryId: dailyGoodsCategoryId,
        });
        const correctedName = `固形せっけん3コ-${crypto.randomUUID()}`;
        await settleLine(
            {
                rawName: correctedName,
                suggestedBaseUnit: "g",
                suggestedBaseDimension: "mass",
                suggestedCategoryId: foodCategoryId,
                suggestedCategoryName: "食料品",
            },
            correctedItem.id,
        );
        const asSuggestedItem = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const asSuggestedName = `提案どおりの商品-${crypto.randomUUID()}`;
        await settleLine(
            {
                rawName: asSuggestedName,
                suggestedBaseUnit: "個",
                suggestedBaseDimension: "count",
                suggestedCategoryId: foodCategoryId,
            },
            asSuggestedItem.id,
        );

        const output = await listExamples({
            names: [asSuggestedName, correctedName],
        });

        expect(output.examples).toHaveLength(2);
        // 訂正された例が先に並ぶ
        expect(output.examples[0]).toMatchObject({
            rawName: correctedName,
            itemName: correctedItem.name,
            baseUnit: "個",
            categoryName: "日用品",
            suggestedBaseUnit: "g",
            suggestedBaseDimension: "mass",
            corrected: true,
        });
        expect(output.examples[1]).toMatchObject({
            rawName: asSuggestedName,
            corrected: false,
        });

        const onlyCorrected = await listExamples({
            names: [asSuggestedName, correctedName],
            correctedOnly: true,
        });

        expect(
            onlyCorrected.examples.map((example) => example.rawName),
        ).toEqual([correctedName]);
        // 条件に合う例が無い表記も notFound で答える
        expect(onlyCorrected.notFound).toEqual([asSuggestedName]);
    });

    it("単位の綴りが違うだけの行は corrected にしない", async () => {
        // 解析の提案は保存時に単位表の綴りへ揃うが（ml → mL）、品目側は
        // 旧表記のまま残る。素で比べると同じ単位が「訂正された例」に化けて
        // correctedOnly の枠を埋め、本当に直された例がモデルへ届かなくなる
        const legacyUnitItem = await createTestItem({
            baseUnit: "ml",
            baseDimension: "volume",
        });
        const legacyUnitName = `旧表記の飲料-${crypto.randomUUID()}`;
        await settleLine(
            {
                rawName: legacyUnitName,
                suggestedBaseUnit: "mL",
                suggestedBaseDimension: "volume",
                suggestedCategoryId: foodCategoryId,
            },
            legacyUnitItem.id,
        );

        const output = await listExamples({ names: [legacyUnitName] });

        expect(output.examples).toHaveLength(1);
        expect(output.examples[0]).toMatchObject({
            rawName: legacyUnitName,
            baseUnit: "ml",
            suggestedBaseUnit: "mL",
            corrected: false,
        });
    });

    it("同じ表記を何度も買っていても、最後に反映した 1 件へ畳む", async () => {
        const firstItem = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const secondItem = await createTestItem({
            baseUnit: "本",
            baseDimension: "count",
        });
        // 表記は同じで、反映先だけを後から変える
        const rawName = `ぎゅうにゅう-${crypto.randomUUID()}`;
        await settleLine({ rawName }, firstItem.id);
        await settleLine({ rawName }, secondItem.id);

        const output = await listExamples({ names: [rawName] });

        // 反映時刻が同じミリ秒に収まっても、行 ID（UUIDv7）が後勝ちを決める
        expect(output.examples).toHaveLength(1);
        expect(output.examples[0]).toMatchObject({
            itemName: secondItem.name,
            baseUnit: "本",
        });
    });

    it("limit は表記を指定しない一覧だけに効き、指定した表記は落とさない", async () => {
        const item = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const names = [
            `まとめて引く商品A-${crypto.randomUUID()}`,
            `まとめて引く商品B-${crypto.randomUUID()}`,
            `まとめて引く商品C-${crypto.randomUUID()}`,
        ];
        for (const rawName of names) {
            await settleLine({ rawName }, item.id);
        }

        const asked = await listExamples({ names, limit: 1 });

        expect(asked.examples.map((example) => example.rawName).sort()).toEqual(
            [...names].sort(),
        );
        expect(asked.notFound).toEqual([]);

        // 表記を指定しない一覧では上限として効く。DB は他のテストと共有なので
        // 件数の上限だけを見る
        const browsed = await listExamples({ limit: 2 });

        expect(browsed.examples.length).toBeLessThanOrEqual(2);
        expect(browsed.notFound).toEqual([]);
    });

    it("表記の指定が上限を超える呼び出しは、入力の検証で拒否する", async () => {
        const names = Array.from(
            { length: receiptExampleNamesMax + 1 },
            (_, index) => `上限超えの商品-${index}`,
        );

        // 上限は tool の inputSchema にも載るため、service の検証まで届かず
        // MCP SDK が先に拒否する。利用者へは同じ「入力が不正」として返る
        expect(
            toolErrorText(await mcp.call("list_receipt_examples", { names })),
        ).toContain("names");
    });
});
