import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { mcpUsageSummarySchema } from "../../domain/usage";
import {
    getMcpUsage,
    McpUsageServiceError,
} from "../../services/mcpUsageService";
import type { ApiBindings } from "../bindings";

export const usageApp = new OpenAPIHono<ApiBindings>();

const errorSchema = z.object({
    error: z.object({ code: z.string(), message: z.string() }),
});

const mcpUsageRoute = createRoute({
    method: "get",
    path: "/mcp",
    tags: ["Usage"],
    summary: "Get MCP tool usage",
    operationId: "getMcpUsage",
    description:
        "Returns MCP call totals and canonical tool-grouped usage from mcp_tool_calls. It includes the most recent call timestamps and a 30-day UTC activity series. Request payloads, responses, credentials, and secrets are never returned.",
    responses: {
        200: {
            description: "MCP tool usage and recent activity.",
            content: { "application/json": { schema: mcpUsageSummarySchema } },
        },
        500: {
            description: "The stored usage data could not be read.",
            content: { "application/json": { schema: errorSchema } },
        },
    },
});

usageApp.openapi(mcpUsageRoute, async (c) => {
    try {
        return c.json(await getMcpUsage(c.env.DB), 200);
    } catch (error) {
        if (error instanceof McpUsageServiceError) {
            return c.json(
                { error: { code: error.code, message: error.message } },
                500,
            );
        }
        return c.json(
            {
                error: {
                    code: "INTERNAL_ERROR",
                    message: "内部エラーが発生しました。",
                },
            },
            500,
        );
    }
});
