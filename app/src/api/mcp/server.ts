import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ItemSearchEnv } from "../../services/itemSearchService";
import { registerCategoryTools } from "./tools/categories";
import { registerExternalProviderTools } from "./tools/external-providers";
import { registerHealthTool } from "./tools/health";
import { registerInventoryTools } from "./tools/inventory";
import { registerInventoryWriteTools } from "./tools/inventory-write";
import { registerLocationTools } from "./tools/locations";

// D1Database ではなく ItemSearchEnv を満たす構造型で受ける。書き込み系 tool が
// 品目の索引更新（VECTORIZE、SETTINGS_ENCRYPTION_KEY）を呼べるようにするため。
// `Cloudflare.Env`（Hono の `c.env`）はこの型を構造的に満たすので、
// handler.ts は c.env をそのまま渡せる
export const createMcpServer = (env: ItemSearchEnv): McpServer => {
    const server = new McpServer({
        name: "inventia-api",
        version: "1.0.0",
    });

    registerHealthTool(server);
    registerInventoryTools(server, env);
    registerLocationTools(server, env.DB);
    registerCategoryTools(server, env.DB);
    registerExternalProviderTools(server, env.DB);
    registerInventoryWriteTools(server, env);

    return server;
};
