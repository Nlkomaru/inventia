import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { categoryDtoSchema } from "../../../domain/category";
import { itemBatchOutputSchema, itemDtoSchema } from "../../../domain/item";
import { locationDtoSchema } from "../../../domain/location";
import { stockOperationResultSchema } from "../../../domain/stock";
import { listStockHistory } from "../../../services/stockService";
import {
    createTestMcpClient,
    type TestMcpClient,
    toolResult,
} from "../../../test/mcp-client";

// 0001_seed_base_categories.sql が投入するルートカテゴリ
const dailyGoodsId = "019fdcef-ee13-7178-9c19-2a5bde5c3778";

describe("update_inventory_item によるカテゴリ・保管場所の移行", () => {
    let mcp: TestMcpClient;
    let suffix: string;

    beforeEach(async () => {
        mcp = await createTestMcpClient();
        suffix = crypto.randomUUID();
    });

    afterEach(async () => {
        await mcp.close();
    });

    const call = async (name: string, args: Record<string, unknown>) =>
        toolResult(await mcp.call(name, args));

    const getItem = async (id: string) => {
        const batch = itemBatchOutputSchema.parse(
            await call("get_inventory_items", { ids: [id] }),
        );
        const item = batch.items[0];
        if (!item) {
            throw new Error(`item ${id} was not found`);
        }
        return item;
    };

    it("MCP で作成したカテゴリと保管場所へ、1 回の更新で在庫品を移せる", async () => {
        const category = categoryDtoSchema.parse(
            await call("create_category", {
                name: `洗濯用品-${suffix}`,
                parentId: dailyGoodsId,
            }),
        );
        const room = locationDtoSchema.parse(
            await call("create_location", {
                name: `リビングルーム-${suffix}`,
            }),
        );
        const washer = locationDtoSchema.parse(
            await call("create_location", {
                name: `洗濯機-${suffix}`,
                parentId: room.id,
            }),
        );

        // 移行前の品目は別のカテゴリ・保管場所に置き、在庫とロットと履歴を持たせる
        const origin = locationDtoSchema.parse(
            await call("create_location", { name: `脱衣所-${suffix}` }),
        );
        const created = itemDtoSchema.parse(
            await call("create_inventory_item", {
                name: `さらさ-${suffix}`,
                categoryId: dailyGoodsId,
                locationId: origin.id,
                baseUnit: "個",
                baseDimension: "count",
                currentQuantity: 3,
                expiryDate: "2027-01-31T00:00:00.000Z",
            }),
        );
        stockOperationResultSchema.parse(
            await call("adjust_inventory_stock", {
                itemId: created.id,
                delta: -1,
                reason: "consume",
                idempotencyKey: `move-${suffix}`,
            }),
        );

        const before = await getItem(created.id);
        const historyBefore = await listStockHistory(env.DB, {
            itemId: created.id,
        });
        expect(before.currentQuantity).toBe(2);
        expect(historyBefore.movements).toHaveLength(2);

        const moved = itemDtoSchema.parse(
            await call("update_inventory_item", {
                id: created.id,
                categoryId: category.id,
                locationId: washer.id,
            }),
        );

        expect(moved).toMatchObject({
            id: created.id,
            categoryId: category.id,
            locationId: washer.id,
        });

        // 移行は台帳を書き換えない。数量、ロット、履歴は移行前のまま残る
        const after = await getItem(created.id);
        expect(after.currentQuantity).toBe(before.currentQuantity);
        expect(after.lots).toEqual(before.lots);
        expect(after.earliestExpiryDate).toBe(before.earliestExpiryDate);
        const historyAfter = await listStockHistory(env.DB, {
            itemId: created.id,
        });
        expect(historyAfter.movements).toEqual(historyBefore.movements);
    });
});
