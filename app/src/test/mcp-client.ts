import { env } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { createMcpServer } from "../api/mcp/server";

// client.callTool の戻り値は互換形式との union なので、応答スキーマで絞り込む。
// 絞り込みを二重キャストで済ませず、MCP の応答形式そのものも検証する
export type ToolResponse = ReturnType<typeof CallToolResultSchema.parse>;

export interface TestMcpClient {
    /** 登録済みの tool を名前で呼ぶ。応答は成功もエラーもそのまま返す。 */
    call: (
        name: string,
        args?: Record<string, unknown>,
    ) => Promise<ToolResponse>;
    close: () => Promise<void>;
}

/**
 * /api/mcp と同じ MCP server をテスト内で接続する。tool は登録された入出力
 * スキーマとハンドラのまま呼ばれるため、service を直接呼ぶのではなく MCP の
 * 契約を検証できる。`env` は createMcpServer が求める ItemSearchEnv と
 * StoreSearchEnv を構造的に満たす。ただし vitest.config.ts は D1 しか binding を
 * 用意しないため、VECTORIZE / VECTORIZE_STORES / SETTINGS_ENCRYPTION_KEY は実行時に
 * undefined で、それらを引く tool は索引を使わない経路だけを検証できる。
 */
export const createTestMcpClient = async (): Promise<TestMcpClient> => {
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    const server = createMcpServer(env);
    // 既定の Ajv は検証関数を new Function で生成するため Workers で動かない
    const client = new Client(
        { name: "inventia-test", version: "1.0.0" },
        { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    );
    const close = async (): Promise<void> => {
        await client.close().catch(() => undefined);
        await server.close().catch(() => undefined);
    };
    try {
        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);
        return {
            call: async (name, args = {}) =>
                CallToolResultSchema.parse(
                    await client.callTool({ name, arguments: args }),
                ),
            close,
        };
    } catch (error) {
        await close();
        throw error;
    }
};

const toolText = (result: ToolResponse): string =>
    result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");

/** 成功応答から structuredContent を取り出す。エラー応答は本文を添えて失敗させる。 */
export const toolResult = (result: ToolResponse): unknown => {
    if (result.isError) {
        throw new Error(`tool returned an error: ${toolText(result)}`);
    }
    return result.structuredContent;
};

/** エラー応答の本文（`CODE: message`）を取り出す。成功応答は失敗させる。 */
export const toolErrorText = (result: ToolResponse): string => {
    if (!result.isError) {
        throw new Error("tool unexpectedly succeeded");
    }
    return toolText(result);
};
