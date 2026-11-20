import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCategory } from "./categoryService";
import { createItem } from "./itemService";
import { createLocation } from "./locationService";
import {
    cancelPriceResearchRequest,
    completePriceResearchRequest,
    createPriceResearchRequest,
    listPriceResearchRequests,
    PriceResearchServiceError,
} from "./priceResearchService";
import { createStore } from "./storeService";

const seedMasterData = async (suffix: string) => {
    const category = await createCategory(env.DB, {
        name: `食材-${suffix}`,
        kind: "food",
    });
    const location = await createLocation(env.DB, {
        name: `キッチン-${suffix}`,
    });
    const item = await createItem(env.DB, {
        name: `強力粉-${suffix}`,
        categoryId: category.id,
        locationId: location.id,
        baseUnit: "g",
        baseDimension: "mass",
    });
    const store = await createStore(env, {
        name: `スーパー-${suffix}`,
    });
    return { category, location, item, store };
};

describe("priceResearchService", () => {
    it("既存品目IDを指定して作成すると品目名・基準単位が補完される", async () => {
        const suffix = crypto.randomUUID();
        const { item } = await seedMasterData(suffix);

        const created = await createPriceResearchRequest(env, {
            itemId: item.id,
            purpose: "パン作りの原価確認",
            note: "1kg 袋の値段を知りたい",
            requestedBy: "ai-assistant",
        });

        expect(created.status).toBe("pending");
        expect(created.itemId).toBe(item.id);
        expect(created.requestedItemName).toBe(item.name);
        expect(created.requestedUnit).toBe("g");
        expect(created.purpose).toBe("パン作りの原価確認");
        expect(created.note).toBe("1kg 袋の値段を知りたい");
        expect(created.requestedBy).toBe("ai-assistant");
        expect(created.item).toEqual({
            id: item.id,
            name: item.name,
            baseUnit: "g",
            baseDimension: "mass",
        });
        expect(created.priceRecord).toBeNull();
    });

    it("存在しない itemId を指定すると 404 エラーになる", async () => {
        await expect(
            createPriceResearchRequest(env, {
                itemId: "non-existent-item-id",
            }),
        ).rejects.toMatchObject({
            name: "PriceResearchServiceError",
            code: "PRICE_RESEARCH_ITEM_NOT_FOUND",
            status: 404,
        });
    });

    it("itemId なしで未登録品目の依頼を作成し、新規品目を作成しながら完了できる", async () => {
        const suffix = crypto.randomUUID();
        const { category, location, store } = await seedMasterData(suffix);

        const created = await createPriceResearchRequest(env, {
            requestedItemName: `オリーブオイル-${suffix}`,
            requestedUnit: "mL",
            purpose: "パスタ原価計算",
            requestedBy: "ai",
        });

        expect(created.itemId).toBeNull();
        expect(created.item).toBeNull();
        expect(created.requestedUnit).toBe("mL");

        const completed = await completePriceResearchRequest(env, created.id, {
            contentAmount: 1,
            contentUnit: "L",
            setCount: 1,
            price: 1200,
            storeId: store.id,
            packaging: "瓶",
            newItem: {
                name: `オリーブオイル-${suffix}`,
                categoryId: category.id,
                locationId: location.id,
                baseUnit: "mL",
                baseDimension: "volume",
            },
        });

        expect(completed.status).toBe("completed");
        expect(completed.itemId).not.toBeNull();
        expect(completed.item).toMatchObject({
            name: `オリーブオイル-${suffix}`,
            baseUnit: "mL",
            baseDimension: "volume",
        });
        expect(completed.priceRecordId).not.toBeNull();
        expect(completed.completedAt).not.toBeNull();
        expect(completed.priceRecord).toMatchObject({
            price: 1200,
            contentAmount: 1000,
            setCount: 1,
            baseUnit: "mL",
            baseDimension: "volume",
            unitPrice: 120,
            storeId: store.id,
            storeName: store.name,
            packaging: "瓶",
        });
    });

    it("既存品目付き依頼を kg 入力で完了すると g に換算して記録し単価を返す", async () => {
        const suffix = crypto.randomUUID();
        const { item, store } = await seedMasterData(suffix);

        const created = await createPriceResearchRequest(env, {
            itemId: item.id,
        });

        const completed = await completePriceResearchRequest(env, created.id, {
            contentAmount: 1,
            contentUnit: "kg",
            setCount: 2,
            price: 600,
            storeId: store.id,
        });

        expect(completed.status).toBe("completed");
        expect(completed.priceRecord).toMatchObject({
            contentAmount: 1000,
            setCount: 2,
            price: 600,
            baseUnit: "g",
            unitPrice: 30,
        });
    });

    it("itemId なしの依頼で itemId も newItem も渡さないと 400 エラーになる", async () => {
        const suffix = crypto.randomUUID();
        const { store } = await seedMasterData(suffix);

        const created = await createPriceResearchRequest(env, {
            requestedItemName: `未紐付け-${suffix}`,
        });

        await expect(
            completePriceResearchRequest(env, created.id, {
                contentAmount: 100,
                contentUnit: "g",
                setCount: 1,
                price: 300,
                storeId: store.id,
            }),
        ).rejects.toMatchObject({
            code: "PRICE_RESEARCH_INVALID_INPUT",
            status: 400,
        });
    });

    it("完了済み・キャンセル済みの依頼は再度完了やキャンセルできない", async () => {
        const suffix = crypto.randomUUID();
        const { item, store } = await seedMasterData(suffix);

        const req1 = await createPriceResearchRequest(env, { itemId: item.id });
        await completePriceResearchRequest(env, req1.id, {
            contentAmount: 500,
            contentUnit: "g",
            setCount: 1,
            price: 250,
            storeId: store.id,
        });

        await expect(
            completePriceResearchRequest(env, req1.id, {
                contentAmount: 500,
                contentUnit: "g",
                setCount: 1,
                price: 250,
                storeId: store.id,
            }),
        ).rejects.toMatchObject({
            code: "PRICE_RESEARCH_CONFLICT",
            status: 409,
        });

        await expect(
            cancelPriceResearchRequest(env, req1.id),
        ).rejects.toMatchObject({
            code: "PRICE_RESEARCH_CONFLICT",
            status: 409,
        });

        const req2 = await createPriceResearchRequest(env, { itemId: item.id });
        const cancelled = await cancelPriceResearchRequest(env, req2.id);
        expect(cancelled.status).toBe("cancelled");

        await expect(
            cancelPriceResearchRequest(env, req2.id),
        ).rejects.toMatchObject({
            code: "PRICE_RESEARCH_CONFLICT",
            status: 409,
        });
    });

    it("ステータス絞り込みと cursor ページングが動作する", async () => {
        const suffix = crypto.randomUUID();
        const { item } = await seedMasterData(suffix);

        const r1 = await createPriceResearchRequest(env, {
            itemId: item.id,
            requestedItemName: `A-${suffix}`,
        });
        const r2 = await createPriceResearchRequest(env, {
            itemId: item.id,
            requestedItemName: `B-${suffix}`,
        });
        const r3 = await createPriceResearchRequest(env, {
            itemId: item.id,
            requestedItemName: `C-${suffix}`,
        });
        await cancelPriceResearchRequest(env, r2.id);

        const page1 = await listPriceResearchRequests(env, {
            status: "pending",
            limit: 1,
        });
        expect(page1.items).toHaveLength(1);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await listPriceResearchRequests(env, {
            status: "pending",
            limit: 50,
            cursor: page1.nextCursor ?? undefined,
        });
        const allPendingIds = [
            ...page1.items.map((entry) => entry.id),
            ...page2.items.map((entry) => entry.id),
        ];
        expect(allPendingIds).toContain(r1.id);
        expect(allPendingIds).toContain(r3.id);
        expect(allPendingIds).not.toContain(r2.id);

        await expect(
            listPriceResearchRequests(env, { cursor: "invalid-cursor" }),
        ).rejects.toBeInstanceOf(PriceResearchServiceError);
    });
});
