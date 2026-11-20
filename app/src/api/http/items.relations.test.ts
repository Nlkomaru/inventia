import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { itemDetailDtoSchema, itemDtoSchema } from "../../domain/item";
import {
    itemRelationDtoSchema,
    itemRelationUnlinkResultSchema,
} from "../../domain/itemRelation";
import { createCategory } from "../../services/categoryService";
import { createItem } from "../../services/itemService";
import { createLocation } from "../../services/locationService";
import { createTestAuthHeaders } from "../../test/apiTokenAuth";
import {
    createTestMcpClient,
    type TestMcpClient,
    toolResult,
} from "../../test/mcp-client";
import { apiApp } from "../app";

// 0001_seed_base_categories.sql が投入するルートカテゴリ
const dailyGoodsId = "019fdcef-ee13-7178-9c19-2a5bde5c3778";

describe("HTTP & MCP item relations", () => {
    let mcp: TestMcpClient;
    let suffix: string;
    let categoryId: string;
    let locationId: string;

    beforeEach(async () => {
        mcp = await createTestMcpClient();
        suffix = crypto.randomUUID().slice(0, 8);
        const category = await createCategory(env.DB, {
            name: `APIテストカテゴリ-${suffix}`,
            parentId: dailyGoodsId,
        });
        const location = await createLocation(env.DB, {
            name: `APIテスト場所-${suffix}`,
        });
        categoryId = category.id;
        locationId = location.id;
    });

    afterEach(async () => {
        await mcp.close();
    });

    it("HTTP API で子品目の紐付け・取得・解除ができる", async () => {
        const parent = await createItem(env.DB, {
            name: `さらさ-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "mL",
            baseDimension: "volume",
            currentQuantity: 850,
        });
        const child = await createItem(env.DB, {
            name: `さらさ詰め替え-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "mL",
            baseDimension: "volume",
            currentQuantity: 1640,
        });

        const headers = await createTestAuthHeaders();
        const linkRes = await apiApp.request(
            `/api/items/${parent.id}/children`,
            {
                method: "POST",
                headers: { ...headers, "content-type": "application/json" },
                body: JSON.stringify({
                    childItemId: child.id,
                    label: "詰め替え",
                }),
            },
            env,
        );
        expect(linkRes.status).toBe(201);
        const relation = itemRelationDtoSchema.parse(await linkRes.json());
        expect(relation.parentItemId).toBe(parent.id);
        expect(relation.childItemId).toBe(child.id);
        expect(relation.label).toBe("詰め替え");

        const detailRes = await apiApp.request(
            `/api/items/${parent.id}`,
            { method: "GET", headers },
            env,
        );
        expect(detailRes.status).toBe(200);
        const detail = itemDetailDtoSchema.parse(await detailRes.json());
        expect(detail.familyTotalQuantity).toBe(2490);
        expect(detail.childItems).toHaveLength(1);
        expect(detail.childItems[0]?.id).toBe(child.id);

        const listRes = await apiApp.request(
            `/api/items?q=${encodeURIComponent(`さらさ-${suffix}`)}`,
            { method: "GET", headers },
            env,
        );
        expect(listRes.status).toBe(200);
        const listBody = (await listRes.json()) as { items: unknown[] };
        const listedItems = listBody.items.map((item) =>
            itemDtoSchema.parse(item),
        );
        expect(listedItems.some((item) => item.id === parent.id)).toBe(true);

        const unlinkRes = await apiApp.request(
            `/api/items/${parent.id}/children/${child.id}`,
            { method: "DELETE", headers },
            env,
        );
        expect(unlinkRes.status).toBe(200);
        expect(
            itemRelationUnlinkResultSchema.parse(await unlinkRes.json()),
        ).toEqual({ unlinked: true });
    });

    it("MCP ツール link_item_relation / unlink_item_relation が動作し get_inventory_items に反映される", async () => {
        const parent = await createItem(env.DB, {
            name: `麦茶-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "袋",
            baseDimension: "count",
            currentQuantity: 1,
        });
        const child = await createItem(env.DB, {
            name: `麦茶予備-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "袋",
            baseDimension: "count",
            currentQuantity: 3,
        });

        const linked = itemRelationDtoSchema.parse(
            toolResult(
                await mcp.call("link_item_relation", {
                    parentItemId: parent.id,
                    childItemId: child.id,
                    label: "予備",
                }),
            ),
        );
        expect(linked.parentItemId).toBe(parent.id);

        const batch = toolResult(
            await mcp.call("get_inventory_items", { ids: [child.id] }),
        ) as { items: unknown[] };
        const childDto = itemDetailDtoSchema.parse(batch.items[0]);
        expect(childDto.familyTotalQuantity).toBe(4);
        expect(childDto.parentItem?.id).toBe(parent.id);

        const unlinked = itemRelationUnlinkResultSchema.parse(
            toolResult(
                await mcp.call("unlink_item_relation", {
                    parentItemId: parent.id,
                    childItemId: child.id,
                }),
            ),
        );
        expect(unlinked).toEqual({ unlinked: true });
    });
});
