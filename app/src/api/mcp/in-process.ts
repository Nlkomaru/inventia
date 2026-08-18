import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import { createMcpServer } from "./server";

/**
 * レシート解析の LLM へ渡してよい tool。読み取り専用のものだけを明示し、
 * server.ts へ書き込み系 tool が増えても解析経路へ漏れないようにする。
 */
export const receiptParseToolAllowlist = [
    "search_inventory",
    "get_inventory_item",
    "list_expiring_inventory",
    "get_price_history",
    "compare_unit_prices",
    "list_categories",
    "get_category",
    "list_locations",
    "get_location",
] as const;

export interface InProcessMcpToolSet {
    tools: ToolSet;
    /** transport とクライアントを解放する。呼び出し側は finally で必ず呼ぶ。 */
    close: () => Promise<void>;
}

/**
 * tool の応答をモデルへ渡す形へ均す。MCP の封筒をそのまま渡すと
 * 中身と同じ量の wrapper JSON をトークンとして消費するため、
 * structuredContent があればそれだけを返す。
 */
const flattenToolResult = (result: object): unknown => {
    if (
        "structuredContent" in result &&
        result.structuredContent !== undefined
    ) {
        return result.structuredContent;
    }
    if (!("content" in result) || !Array.isArray(result.content)) {
        return null;
    }
    const texts: string[] = [];
    for (const part of result.content) {
        if (
            typeof part === "object" &&
            part !== null &&
            "type" in part &&
            part.type === "text" &&
            "text" in part &&
            typeof part.text === "string"
        ) {
            texts.push(part.text);
        }
    }
    return texts.length > 0 ? texts.join("\n") : null;
};

/**
 * /api/mcp と同じ MCP server をプロセス内で接続し、AI SDK の tool として返す。
 * HTTP を経由しないため Cloudflare Access の資格情報は要らず、tool の説明も
 * MCP の定義をそのまま使う。
 */
export const createInProcessMcpToolSet = async (
    db: D1Database,
    allowlist: readonly string[] = receiptParseToolAllowlist,
): Promise<InProcessMcpToolSet> => {
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    const server = createMcpServer(db);
    const client = new Client(
        {
            name: "inventia-in-process",
            version: "1.0.0",
        },
        // 既定の Ajv は検証関数を new Function で生成するため Workers で動かない
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
        const listed = await client.listTools();
        const allowed = new Set(allowlist);
        const tools: ToolSet = {};
        for (const definition of listed.tools) {
            if (!allowed.has(definition.name)) {
                continue;
            }
            tools[definition.name] = dynamicTool({
                description: definition.description ?? definition.title ?? "",
                inputSchema: jsonSchema(definition.inputSchema),
                execute: async (input) => {
                    const result = await client.callTool({
                        name: definition.name,
                        arguments: (input ?? {}) as Record<string, unknown>,
                    });
                    return flattenToolResult(result);
                },
            });
        }
        return { tools, close };
    } catch (error) {
        await close();
        throw error;
    }
};
