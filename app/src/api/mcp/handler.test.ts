import { env } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { listMcpToolCalls } from "../../repositories/mcpToolUsageRepository";
import { createTestAuthHeaders } from "../../test/apiTokenAuth";
import { apiApp } from "../app";
import { createMcpServer } from "./server";

describe("MCP HTTP handler", () => {
    it("records each tools/call before dispatching it", async () => {
        const response = await apiApp.fetch(
            new Request("https://inventia.test/api/mcp", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(await createTestAuthHeaders()),
                },
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
    it("exposes semantic inventory search instead of normal search", async () => {
        const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
        const server = createMcpServer(env);
        const client = new Client({
            name: "inventia-test",
            version: "1.0.0",
        });
        try {
            await Promise.all([
                server.connect(serverTransport),
                client.connect(clientTransport),
            ]);
            const listed = await client.listTools();
            const toolNames = listed.tools.map((tool) => tool.name);

            expect(toolNames).toContain("search_inventory_semantic");
            expect(toolNames).not.toContain("search_inventory");
        } finally {
            await client.close();
            await server.close();
        }
    });
});
