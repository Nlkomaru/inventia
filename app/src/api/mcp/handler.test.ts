import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { listMcpToolCalls } from "../../repositories/mcpToolUsageRepository";
import { apiApp } from "../app";

describe("MCP HTTP handler", () => {
    it("records each tools/call before dispatching it", async () => {
        const response = await apiApp.fetch(
            new Request("https://inventia.test/api/mcp", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: crypto.randomUUID(),
                    method: "tools/call",
                    params: { name: "get_health", arguments: {} },
                }),
            }),
            env,
        );

        expect(response.status).toBe(200);
        const calls = await listMcpToolCalls(env.DB, "get_health");
        expect(calls.at(-1)).toMatchObject({
            id: expect.any(String),
            toolId: expect.any(String),
            calledAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        });
    });
});
