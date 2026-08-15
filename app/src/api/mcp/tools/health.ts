import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { healthSchema } from "../../../domain/health";
import { getHealth } from "../../../services/healthService";
import { mcpSuccess } from "../result";

export const registerHealthTool = (server: McpServer): void => {
    server.registerTool(
        "get_health",
        {
            title: "Get API health",
            description:
                "Get the current health status, deployment time, and check time for the Inventia API.",
            inputSchema: z.object({}),
            outputSchema: healthSchema,
        },
        async () => mcpSuccess(getHealth()),
    );
};
