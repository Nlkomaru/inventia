import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    locationDtoSchema,
    locationListOutputSchema,
} from "../../../domain/location";
import {
    createTestMcpClient,
    type TestMcpClient,
    toolErrorText,
    toolResult,
} from "../../../test/mcp-client";

describe("create_location", () => {
    let mcp: TestMcpClient;
    // 保管場所には seed が無いため、テストごとにルートを作ってから枝を伸ばす
    let name: string;

    beforeEach(async () => {
        mcp = await createTestMcpClient();
        name = `テスト-${crypto.randomUUID()}`;
    });

    afterEach(async () => {
        await mcp.close();
    });

    const createRoot = async () =>
        locationDtoSchema.parse(
            toolResult(
                await mcp.call("create_location", {
                    name: `ルート-${crypto.randomUUID()}`,
                }),
            ),
        );

    it("parentId 未指定ならルートに作成し、生成された ID を返す", async () => {
        const created = locationDtoSchema.parse(
            toolResult(
                await mcp.call("create_location", { name, sortOrder: 3 }),
            ),
        );

        expect(created.id).not.toHaveLength(0);
        expect(created).toMatchObject({
            name,
            parentId: null,
            sortOrder: 3,
        });
    });

    it("親の下に作成し、その階層の一覧で確認できる", async () => {
        const parent = await createRoot();

        const created = locationDtoSchema.parse(
            toolResult(
                await mcp.call("create_location", {
                    name,
                    parentId: parent.id,
                }),
            ),
        );

        expect(created.parentId).toBe(parent.id);
        const listed = locationListOutputSchema.parse(
            toolResult(
                await mcp.call("list_locations", { parentId: parent.id }),
            ),
        );
        expect(listed.items.map((item) => item.id)).toEqual([created.id]);
    });

    it("同じ親の下の同名は LOCATION_NAME_CONFLICT を返す", async () => {
        const parent = await createRoot();
        toolResult(
            await mcp.call("create_location", { name, parentId: parent.id }),
        );

        const conflict = await mcp.call("create_location", {
            name,
            parentId: parent.id,
        });

        expect(toolErrorText(conflict)).toContain("LOCATION_NAME_CONFLICT");
    });

    it("親が違えば同じ名前でも別ブランチに作成できる", async () => {
        const first = await createRoot();
        const second = await createRoot();

        const underFirst = locationDtoSchema.parse(
            toolResult(
                await mcp.call("create_location", { name, parentId: first.id }),
            ),
        );
        const underSecond = locationDtoSchema.parse(
            toolResult(
                await mcp.call("create_location", {
                    name,
                    parentId: second.id,
                }),
            ),
        );

        expect(underSecond.id).not.toBe(underFirst.id);
        expect(underSecond.name).toBe(underFirst.name);
        expect(underSecond.parentId).toBe(second.id);
    });

    it("存在しない親には LOCATION_PARENT_NOT_FOUND を返す", async () => {
        const missing = await mcp.call("create_location", {
            name,
            parentId: "missing-location-id",
        });

        expect(toolErrorText(missing)).toContain("LOCATION_PARENT_NOT_FOUND");
    });
});
