import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    categoryDtoSchema,
    categoryListOutputSchema,
} from "../../../domain/category";
import {
    createTestMcpClient,
    type TestMcpClient,
    toolErrorText,
    toolResult,
} from "../../../test/mcp-client";

// 0001_seed_base_categories.sql が投入するルートカテゴリ
const dailyGoodsId = "019fdcef-ee13-7178-9c19-2a5bde5c3778";
const foodId = "019fdcef-ee16-70fb-a3a0-5c5837f334db";

describe("create_category", () => {
    let mcp: TestMcpClient;
    // seed 済みのカテゴリや他のテストと衝突しないよう、名前は毎回変える
    let name: string;

    beforeEach(async () => {
        mcp = await createTestMcpClient();
        name = `テスト-${crypto.randomUUID()}`;
    });

    afterEach(async () => {
        await mcp.close();
    });

    it("親カテゴリの下に作成し、生成された ID を返す", async () => {
        const created = categoryDtoSchema.parse(
            toolResult(
                await mcp.call("create_category", {
                    name,
                    parentId: dailyGoodsId,
                }),
            ),
        );

        expect(created.id).not.toHaveLength(0);
        expect(created).toMatchObject({
            name,
            parentId: dailyGoodsId,
            // kind 未指定は汎用カテゴリで、実効 kind は祖先から解決する
            kind: null,
            sortOrder: 0,
        });

        const listed = categoryListOutputSchema.parse(
            toolResult(
                await mcp.call("list_categories", { parentId: dailyGoodsId }),
            ),
        );
        expect(listed.items.map((item) => item.id)).toContain(created.id);
    });

    it("parentId 未指定ならルートに作成する", async () => {
        const created = categoryDtoSchema.parse(
            toolResult(
                await mcp.call("create_category", {
                    name,
                    kind: "food",
                    sortOrder: 7,
                }),
            ),
        );

        expect(created).toMatchObject({
            parentId: null,
            kind: "food",
            sortOrder: 7,
        });
    });

    it("同じ親の下の同名は CATEGORY_NAME_CONFLICT を返す", async () => {
        toolResult(
            await mcp.call("create_category", { name, parentId: dailyGoodsId }),
        );

        const conflict = await mcp.call("create_category", {
            name,
            parentId: dailyGoodsId,
        });

        expect(toolErrorText(conflict)).toContain("CATEGORY_NAME_CONFLICT");
    });

    it("親が違えば同じ名前でも別ブランチに作成できる", async () => {
        const first = categoryDtoSchema.parse(
            toolResult(
                await mcp.call("create_category", {
                    name,
                    parentId: dailyGoodsId,
                }),
            ),
        );
        const second = categoryDtoSchema.parse(
            toolResult(
                await mcp.call("create_category", { name, parentId: foodId }),
            ),
        );

        expect(second.id).not.toBe(first.id);
        expect(second.name).toBe(first.name);
        expect(second.parentId).toBe(foodId);
    });

    it("存在しない親には CATEGORY_PARENT_NOT_FOUND を返す", async () => {
        const missing = await mcp.call("create_category", {
            name,
            parentId: "missing-category-id",
        });

        expect(toolErrorText(missing)).toContain("CATEGORY_PARENT_NOT_FOUND");
    });
});
