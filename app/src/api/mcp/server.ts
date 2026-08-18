import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCategoryTools } from "./tools/categories";
import { registerHealthTool } from "./tools/health";
import { registerInventoryTools } from "./tools/inventory";
import { registerInventoryWriteTools } from "./tools/inventory-write";
import { registerLocationTools } from "./tools/locations";

export const createMcpServer = (db: D1Database): McpServer => {
    const server = new McpServer({
        name: "inventia-api",
        version: "1.0.0",
    });

    registerHealthTool(server);
    registerInventoryTools(server, db);
    registerLocationTools(server, db);
    registerCategoryTools(server, db);
    registerInventoryWriteTools(server, db);

    return server;
};
