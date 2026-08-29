import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import type { ItemSearchEnv } from "../../services/itemSearchService";
import type { StoreSearchEnv } from "../../services/storeSearchService";
import { createMcpServer } from "./server";

/**
 * レシート解析の LLM へ渡してよい tool。読み取り専用のものだけを明示し、
 * server.ts へ書き込み系 tool が増えても解析経路へ漏れないようにする。
 */
export const receiptParseToolAllowlist = [
    // 明細の表記をまとめて照合する。意味検索で候補を拾った後に、
    // exact / alias の確定と候補の絞り込みへ使う
    "resolve_inventory_items",
    // 店名も同じ理由でまとめて照合する。読み取った店名を既存店舗の登録名へ
    // 寄せられれば、反映時の resolveStoreByName が完全一致で当たり、
    // 同じ店の表記揺れが別の店舗として作られない。読み取り専用で副作用は無い
    "resolve_stores",
    // 品目名の検索は意味検索を使う。略称・ブランド名の前置きなど、
    // レシートと登録名の表記や語彙が違っても候補を拾える
    "search_inventory_semantic",
    // 品目の詳細も明細の行数ぶん引かれるため、id をまとめて受ける一括版だけを渡す
    "get_inventory_items",
    // 過去に利用者が承認して反映した取込結果を実例として引く。同じ商品を毎回
    // 同じ品目名・単位・カテゴリへ寄せられれば、確認画面での直しが減る。
    // 表記を 1 回でまとめて渡せるため往復も 1 回で済み、読み取り専用で
    // 在庫も辞書も動かさない
    "list_receipt_examples",
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
 * MCP の定義をそのまま使う。createMcpServer が品目と店名それぞれの索引まで
 * 要求するため、ここも D1Database ではなく env を受け取る。
 */
export const createInProcessMcpToolSet = async (
    env: ItemSearchEnv & StoreSearchEnv,
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
