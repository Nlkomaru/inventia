import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    priceResearchListOutputSchema,
    priceResearchRequestDtoSchema,
} from "../../../domain/priceResearch";
import { createCategory } from "../../../services/categoryService";
import { createItem } from "../../../services/itemService";
import { createLocation } from "../../../services/locationService";
import { createStore } from "../../../services/storeService";
import {
    createTestMcpClient,
    type TestMcpClient,
    toolErrorText,
    toolResult,
} from "../../../test/mcp-client";
import { priceResearchApp } from "../../http/price-research";

describe("price-research MCP tools and HTTP API", () => {
    let mcp: TestMcpClient;

    beforeEach(async () => {
        mcp = await createTestMcpClient();
    });

    afterEach(async () => {
        await mcp.close();
    });

    it("MCP で調査依頼を作成し、HTTP で完了し、MCP の一覧で単価を参照できる", async () => {
        const suffix = crypto.randomUUID();
        const category = await createCategory(env.DB, {
            name: `日用品-${suffix}`,
            kind: "daily_goods",
        });
        const location = await createLocation(env.DB, {
            name: `洗面所-${suffix}`,
        });
        const item = await createItem(env.DB, {
            name: `洗剤-${suffix}`,
            categoryId: category.id,
            locationId: location.id,
            baseUnit: "mL",
            baseDimension: "volume",
        });
        const store = await createStore(env, {
            name: `ドラッグストア-${suffix}`,
        });

        const createdRaw = toolResult(
            await mcp.call("request_price_research", {
                itemId: item.id,
                purpose: "詰め替え単価の比較",
                note: "特大パックを確認",
                requestedBy: "claude",
            }),
        );
        const created = priceResearchRequestDtoSchema.parse(createdRaw);
        expect(created.status).toBe("pending");
        expect(created.requestedItemName).toBe(item.name);
        expect(created.requestedUnit).toBe("mL");

        const completeRes = await priceResearchApp.request(
            `/${created.id}/complete`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contentAmount: 1,
                    contentUnit: "L",
                    setCount: 1,
                    price: 500,
                    storeId: store.id,
                }),
            },
            env,
        );
        expect(completeRes.status).toBe(200);
        const completed = priceResearchRequestDtoSchema.parse(
            await completeRes.json(),
        );
        expect(completed.status).toBe("completed");
        expect(completed.priceRecord?.unitPrice).toBe(50);

        const listedRaw = toolResult(
            await mcp.call("list_price_research_requests", {
                status: "completed",
                limit: 50,
            }),
        );
        const listed = priceResearchListOutputSchema.parse(listedRaw);
        const found = listed.items.find((entry) => entry.id === created.id);
        expect(found).toBeDefined();
        expect(found?.priceRecord?.unitPrice).toBe(50);
        expect(found?.priceRecord?.baseUnit).toBe("mL");
    });

    it("MCP の cancel_price_research_request で pending 依頼をキャンセルでき、重複キャンセルはエラーになる", async () => {
        const suffix = crypto.randomUUID();
        const created = priceResearchRequestDtoSchema.parse(
            toolResult(
                await mcp.call("request_price_research", {
                    requestedItemName: `未登録スパイス-${suffix}`,
                    requestedUnit: "g",
                }),
            ),
        );

        const cancelled = priceResearchRequestDtoSchema.parse(
            toolResult(
                await mcp.call("cancel_price_research_request", {
                    id: created.id,
                }),
            ),
        );
        expect(cancelled.status).toBe("cancelled");

        const duplicateCancel = await mcp.call(
            "cancel_price_research_request",
            { id: created.id },
        );
        expect(toolErrorText(duplicateCancel)).toContain(
            "PRICE_RESEARCH_CONFLICT",
        );
    });

    it("HTTP POST / と GET / で作成・一覧取得ができる", async () => {
        const suffix = crypto.randomUUID();

        const createRes = await priceResearchApp.request(
            "/",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requestedItemName: `バター-${suffix}`,
                    requestedUnit: "g",
                    purpose: "お菓子作り",
                }),
            },
            env,
        );
        expect(createRes.status).toBe(201);
        const created = priceResearchRequestDtoSchema.parse(
            await createRes.json(),
        );

        const listRes = await priceResearchApp.request(
            "/?status=pending&limit=50",
            { method: "GET" },
            env,
        );
        expect(listRes.status).toBe(200);
        const list = priceResearchListOutputSchema.parse(await listRes.json());
        expect(list.items.some((entry) => entry.id === created.id)).toBe(true);

        const cancelRes = await priceResearchApp.request(
            `/${created.id}/cancel`,
            { method: "POST" },
            env,
        );
        expect(cancelRes.status).toBe(200);
        const cancelled = priceResearchRequestDtoSchema.parse(
            await cancelRes.json(),
        );
        expect(cancelled.status).toBe("cancelled");
    });
});
