import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import type { ItemSearchEnv } from "../../services/itemSearchService";
import { createMcpServer } from "./server";

/**
 * レシート解析の LLM へ渡してよい tool。読み取り専用のものだけを明示し、
 * server.ts へ書き込み系 tool が増えても解析経路へ漏れないようにする。
 */
export const receiptParseToolAllowlist = [
    // 明細の表記をまとめて照合する。1 行ずつ search_inventory を呼ばせると
    // 呼び出し回数が明細の行数に比例し、往復上限を使い切る
    "resolve_inventory_items",
    "search_inventory",
    // レシートの表記（略称やブランド名の前置きなど）は在庫の品目名と語彙が
    // ずれやすく、search_inventory の LIKE 検索だけでは既存品目を見落とす。
    // 意味検索を補助として足すことで既存品目とのマッチ率を上げる。読み取り専用で
    // 副作用が無く、解析はそもそも OpenRouter を呼ぶ経路なので API key 未設定
    // による失敗もこの経路では起きない
    "search_inventory_semantic",
    // 品目の詳細も明細の行数ぶん引かれるため、id をまとめて受ける一括版だけを渡す
    "get_inventory_items",
    "list_expiring_inventory",
    "get_price_history",
    "compare_unit_prices",
    // カテゴリは service が解析の指示へ一覧として載せる。`list_categories` は
    // 1 階層ずつ返すため、tool として渡すと木を辿るだけで往復上限を使い切る。
    // 保管場所は木を 1 回で返す tool だけを渡し、階層ごとの list_locations と
    // 1 件ずつの get_location は同じ理由で渡さない
    "list_location_tree",
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
 * MCP の定義をそのまま使う。createMcpServer が ItemSearchEnv を要求するため、
 * ここも D1Database ではなく env を受け取る。
 */
export const createInProcessMcpToolSet = async (
    env: ItemSearchEnv,
    allowlist: readonly string[] = receiptParseToolAllowlist,
): Promise<InProcessMcpToolSet> => {
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    const server = createMcpServer(env);
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
