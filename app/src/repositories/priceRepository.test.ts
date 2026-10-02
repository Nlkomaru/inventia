import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { newId } from "../domain/id";
import { calculateUnitPrice, type PriceRecordDimension } from "../domain/price";
import { createItem, updateItem } from "../services/itemService";
import { createLocation } from "../services/locationService";
import {
    compareUnitPrices,
    createPriceRecord,
    listPriceRecords,
    updatePriceRecord,
} from "../services/priceService";
import {
    insertPriceRecord,
    listPriceRecordsByUnitPrice,
} from "./priceRepository";
import { insertStore } from "./storeRepository";

// 0001_seed_base_categories.sql が投入するルートカテゴリ
const foodCategoryId = "019fdcef-ee16-70fb-a3a0-5c5837f334db";

/** 保管場所は品目ごとに要る。名前の衝突を避けるため毎回作る。 */
const createTestItem = async (input: {
    baseUnit: string;
    baseDimension: PriceRecordDimension;
}): Promise<string> => {
    const location = await createLocation(env.DB, {
        name: `テスト置き場-${crypto.randomUUID()}`,
    });
    const item = await createItem(env.DB, {
        name: `テスト品目-${crypto.randomUUID()}`,
        categoryId: foodCategoryId,
        locationId: location.id,
        baseUnit: input.baseUnit,
        baseDimension: input.baseDimension,
    });
    return item.id;
};

/**
 * SQL の単価式と TS の calculateUnitPrice が同じ答えを返すことを、単位の表記を
 * 変えながら突き合わせる。単価は保存せず読み取りのたびに導くため、品目一覧・
 * 価格履歴（TS）と価格比較（SQL）で式が割れると、同じ 1 件の記録が経路によって
 * 1000 倍ずれた値で読まれる。
 *
 * 内容量は基準単位で保存済みの値なので、repository へ直接書けば単位表に無い
 * 基準単位（袋など）も試せる（service 経由の作成は contentUnit が品目の基準単位と
 * 一致していれば通るため、そこは別の describe で固定する）。
 * 質量・体積で単位表に無い基準単位（袋 / mass など）は calculateUnitPrice が
 * 例外を投げるため突き合わせようがないが、価格記録の作成もつけ替えも同じ換算を
 * 通すので、その組み合わせは書き込み側で作れない。
 */
describe("単価式の TS と SQL の一致", () => {
    const cases: {
        baseUnit: string;
        baseDimension: PriceRecordDimension;
        contentAmount: number;
        price: number;
        expected: number;
    }[] = [
        // 質量・体積は最小単位（g / mL）100 あたりの円で比較する
        {
            baseUnit: "g",
            baseDimension: "mass",
            contentAmount: 500,
            price: 250,
            expected: 50,
        },
        {
            baseUnit: "kg",
            baseDimension: "mass",
            contentAmount: 2,
            price: 400,
            expected: 20,
        },
        // 大文字綴りの基準単位。SQLite の IN は BINARY 照合なので綴りを畳まないと外れる
        {
            baseUnit: "KG",
            baseDimension: "mass",
            contentAmount: 2,
            price: 400,
            expected: 20,
        },
        {
            baseUnit: "mL",
            baseDimension: "volume",
            contentAmount: 2000,
            price: 400,
            expected: 20,
        },
        // レシート解析経由で作られた品目は基準単位が小文字の "ml" で保存されている
        {
            baseUnit: "ml",
            baseDimension: "volume",
            contentAmount: 2000,
            price: 400,
            expected: 20,
        },
        {
            baseUnit: "L",
            baseDimension: "volume",
            contentAmount: 2,
            price: 400,
            expected: 20,
        },
        {
            baseUnit: "l",
            baseDimension: "volume",
            contentAmount: 2,
            price: 400,
            expected: 20,
        },
        // 個数は基準単位がそのまま最小単位で、1 個あたりの円になる
        {
            baseUnit: "個",
            baseDimension: "count",
            contentAmount: 10,
            price: 400,
            expected: 40,
        },
        // 単位表に無い個数単位。品目マスタは利用者の語彙をそのまま基準単位にできる
        {
            baseUnit: "袋",
            baseDimension: "count",
            contentAmount: 10,
            price: 400,
            expected: 40,
        },
        // 個数の品目がたまたま "kg" と名乗っていても、1000 倍の係数を掛けてはいけない
        {
            baseUnit: "kg",
            baseDimension: "count",
            contentAmount: 10,
            price: 400,
            expected: 40,
        },
    ];

    for (const testCase of cases) {
        it(`baseUnit "${testCase.baseUnit}" / ${testCase.baseDimension} の単価が両側で一致する`, async () => {
            const itemId = await createTestItem(testCase);
            await insertPriceRecord(env.DB, {
                itemId,
                contentAmount: testCase.contentAmount,
                setCount: 1,
                price: testCase.price,
                source: "テスト",
                recordedAt: "2026-08-20T00:00:00.000Z",
            });

            const page = await listPriceRecordsByUnitPrice(env.DB, {
                itemId,
                limit: 10,
                cursor: null,
            });

            const row = page.rows[0];
            if (row === undefined) {
                throw new Error("price record was not inserted");
            }
            const fromTypeScript = calculateUnitPrice(
                row.price,
                row.contentAmount,
                row.setCount,
                row.baseDimension,
                row.baseUnit,
            );
            expect(fromTypeScript).toBeCloseTo(testCase.expected, 10);
            expect(row.unitPrice).toBeCloseTo(fromTypeScript, 10);
        });
    }

    it("セット数を掛けた単価も両側で一致する", async () => {
        const itemId = await createTestItem({
            baseUnit: "l",
            baseDimension: "volume",
        });
        await insertPriceRecord(env.DB, {
            itemId,
            contentAmount: 2,
            setCount: 3,
            price: 900,
            source: "テスト",
            recordedAt: "2026-08-20T00:00:00.000Z",
        });

        const page = await listPriceRecordsByUnitPrice(env.DB, {
            itemId,
            limit: 10,
            cursor: null,
        });

        const row = page.rows[0];
        if (row === undefined) {
            throw new Error("price record was not inserted");
        }
        expect(row.unitPrice).toBeCloseTo(
            calculateUnitPrice(
                row.price,
                row.contentAmount,
                row.setCount,
                row.baseDimension,
                row.baseUnit,
            ),
            10,
        );
        // 900 円 / (2 L × 3) = 15 円 / 100 mL
        expect(row.unitPrice).toBeCloseTo(15, 10);
    });
});

/**
 * 基準単位のつけ替えは換算を伴わず、保存済みの内容量はそのまま新しい単位の数量
 * として読まれる。表記だけを畳んだ "l" へのつけ替えでも、価格履歴（TS）と
 * 価格比較（SQL）が同じ単価を返すことを固定する。
 */
describe("基準単位のつけ替え後の単価", () => {
    const unitPrices = async (itemId: string) => {
        const history = await listPriceRecords(env, { itemId });
        const comparison = await compareUnitPrices(env, { itemId });
        const fromHistory = history.items[0]?.unitPrice;
        const fromComparison = comparison.items[0]?.unitPrice;
        if (fromHistory === undefined || fromComparison === undefined) {
            throw new Error("price record was not created");
        }
        return { fromHistory, fromComparison };
    };

    it('mL の品目を "l" へつけ替えても価格履歴と価格比較が割れない', async () => {
        const itemId = await createTestItem({
            baseUnit: "mL",
            baseDimension: "volume",
        });
        await createPriceRecord(env, {
            itemId,
            contentAmount: 2000,
            contentUnit: "mL",
            price: 400,
            source: "テスト",
            recordedAt: "2026-08-20T00:00:00.000Z",
        });

        const before = await unitPrices(itemId);
        expect(before.fromHistory).toBeCloseTo(20, 10);
        expect(before.fromComparison).toBeCloseTo(20, 10);

        await updateItem(env.DB, itemId, { baseUnit: "l" });

        // つけ替えは 2000 を「2000 L」と読み替えるため単価は 1/1000 になるが、
        // どちらの経路も同じ値を返さなければならない
        const after = await unitPrices(itemId);
        expect(after.fromHistory).toBeCloseTo(0.02, 10);
        expect(after.fromComparison).toBeCloseTo(0.02, 10);
    });

    it('g の品目を "KG" へつけ替えても価格履歴と価格比較が割れない', async () => {
        const itemId = await createTestItem({
            baseUnit: "g",
            baseDimension: "mass",
        });
        await createPriceRecord(env, {
            itemId,
            contentAmount: 500,
            contentUnit: "g",
            price: 250,
            source: "テスト",
            recordedAt: "2026-08-20T00:00:00.000Z",
        });

        const before = await unitPrices(itemId);
        expect(before.fromHistory).toBeCloseTo(50, 10);
        expect(before.fromComparison).toBeCloseTo(50, 10);

        await updateItem(env.DB, itemId, { baseUnit: "KG" });

        const after = await unitPrices(itemId);
        expect(after.fromHistory).toBeCloseTo(0.05, 10);
        expect(after.fromComparison).toBeCloseTo(0.05, 10);
    });
});

describe("価格記録の取得元URL", () => {
    it("店舗と商品ページURLを同じ価格記録へ保存する", async () => {
        const itemId = await createTestItem({
            baseUnit: "個",
            baseDimension: "count",
        });
        const store = await insertStore(env.DB, {
            id: newId(),
            name: `ネット通販-${crypto.randomUUID()}`,
            url: "https://example.com",
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
        });

        const record = await createPriceRecord(env, {
            itemId,
            contentAmount: 1,
            contentUnit: "個",
            price: 1980,
            storeId: store.id,
            url: "https://example.com/products/1",
            recordedAt: "2026-08-20T00:00:00.000Z",
        });

        expect(record.storeId).toBe(store.id);
        expect(record.source).toBe(store.name);
        expect(record.url).toBe("https://example.com/products/1");
    });
});

describe("価格記録の訂正", () => {
    it("記録日時を保ったまま内容量と価格を訂正する", async () => {
        const itemId = await createTestItem({
            baseUnit: "g",
            baseDimension: "mass",
        });
        const original = await createPriceRecord(env, {
            itemId,
            contentAmount: 500,
            contentUnit: "g",
            setCount: 1,
            price: 250,
            source: "訂正前",
            recordedAt: "2026-09-01T12:00:00.000Z",
        });

        const corrected = await updatePriceRecord(env, original.id, {
            itemId,
            contentAmount: 2,
            contentUnit: "kg",
            setCount: 3,
            packaging: "詰め替え",
            price: 900,
            source: "訂正後",
            storeId: null,
            url: "https://example.com/products/corrected",
        });

        expect(corrected).toMatchObject({
            contentAmount: 2000,
            setCount: 3,
            packaging: "詰め替え",
            price: 900,
            source: "訂正後",
            storeId: null,
            url: "https://example.com/products/corrected",
            recordedAt: original.recordedAt,
            createdAt: original.createdAt,
        });

        const history = await listPriceRecords(env, { itemId, limit: 1 });
        expect(history.items).toHaveLength(1);
        expect(history.items[0]).toMatchObject({
            id: original.id,
            recordedAt: original.recordedAt,
            contentAmount: 2000,
            price: 900,
        });
    });
});

/**
 * 個数の単位は換算できないため、品目の基準単位と完全に同じ表記でのみ記録できる。
 * 単位表（domain/price.ts の priceContentUnits）は g / kg / mL / L と汎用の
 * 個数単位しか持たないが、実際の品目は 玉・袋・箱 のような利用者の語彙で数える。
 * service の作成と訂正の両方がその表記を受け付け、単価が 1 個あたりで導かれ、
 * 履歴から同じ値で読み戻せることを固定する。
 */
describe("単位表に無い個数の単位の価格記録", () => {
    const arbitraryCountUnits = ["玉", "袋", "箱"];

    for (const unit of arbitraryCountUnits) {
        it(`基準単位 ${unit} の品目に contentUnit ${unit} で作成して読み戻せる`, async () => {
            const itemId = await createTestItem({
                baseUnit: unit,
                baseDimension: "count",
            });

            const created = await createPriceRecord(env, {
                itemId,
                contentAmount: 10,
                contentUnit: unit,
                price: 400,
                source: "テスト",
                recordedAt: "2026-08-20T00:00:00.000Z",
            });

            expect(created).toMatchObject({
                itemId,
                contentAmount: 10,
                baseUnit: unit,
                baseDimension: "count",
                unitPrice: 40,
            });

            const history = await listPriceRecords(env, { itemId });
            expect(history.items).toHaveLength(1);
            expect(history.items[0]).toMatchObject({
                id: created.id,
                contentAmount: 10,
                unitPrice: 40,
            });

            const comparison = await compareUnitPrices(env, { itemId });
            expect(comparison.items[0]?.unitPrice).toBeCloseTo(40, 10);
        });
    }

    it("訂正でも品目の基準単位と同じ contentUnit を使える", async () => {
        const itemId = await createTestItem({
            baseUnit: "袋",
            baseDimension: "count",
        });
        const original = await createPriceRecord(env, {
            itemId,
            contentAmount: 1,
            contentUnit: "袋",
            setCount: 2,
            price: 300,
            source: "訂正前",
            recordedAt: "2026-09-01T12:00:00.000Z",
        });
        // 300 円 / (1 袋 × 2) = 150 円 / 袋
        expect(original.unitPrice).toBeCloseTo(150, 10);

        const corrected = await updatePriceRecord(env, original.id, {
            itemId,
            contentAmount: 2,
            contentUnit: "袋",
            setCount: 1,
            price: 900,
            source: "訂正後",
            storeId: null,
        });

        expect(corrected).toMatchObject({
            contentAmount: 2,
            price: 900,
            recordedAt: original.recordedAt,
        });
        expect(corrected.unitPrice).toBeCloseTo(450, 10);

        const history = await listPriceRecords(env, { itemId, limit: 1 });
        expect(history.items[0]).toMatchObject({
            id: original.id,
            contentAmount: 2,
            price: 900,
        });
        expect(history.items[0]?.unitPrice).toBeCloseTo(450, 10);
    });

    it("品目の基準単位と違う個数単位での作成は拒む", async () => {
        const itemId = await createTestItem({
            baseUnit: "玉",
            baseDimension: "count",
        });

        await expect(
            createPriceRecord(env, {
                itemId,
                contentAmount: 1,
                contentUnit: "袋",
                price: 100,
                source: "テスト",
                recordedAt: "2026-08-20T00:00:00.000Z",
            }),
        ).rejects.toMatchObject({ code: "PRICE_INVALID_INPUT" });

        const history = await listPriceRecords(env, { itemId });
        expect(history.items).toHaveLength(0);
    });

    it("訂正で品目の基準単位と違う個数単位へ差し替えるのは拒み、元の値を保つ", async () => {
        const itemId = await createTestItem({
            baseUnit: "玉",
            baseDimension: "count",
        });
        const original = await createPriceRecord(env, {
            itemId,
            contentAmount: 3,
            contentUnit: "玉",
            price: 600,
            source: "テスト",
            recordedAt: "2026-08-20T00:00:00.000Z",
        });

        await expect(
            updatePriceRecord(env, original.id, {
                itemId,
                contentAmount: 1,
                contentUnit: "箱",
                price: 999,
                source: "テスト",
            }),
        ).rejects.toMatchObject({ code: "PRICE_INVALID_INPUT" });

        const history = await listPriceRecords(env, { itemId, limit: 1 });
        expect(history.items[0]).toMatchObject({
            id: original.id,
            contentAmount: 3,
            price: 600,
        });
        expect(history.items[0]?.unitPrice).toBeCloseTo(200, 10);
    });
});
