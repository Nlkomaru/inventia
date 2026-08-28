import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { listMcpToolCalls, recordMcpToolCall } from "./mcpToolUsageRepository";

describe("MCP tool usage records", () => {
    it("stores each call by normalized tool id and time without repeating the tool name", async () => {
        const toolName = `usage-test-${crypto.randomUUID()}`;
        await recordMcpToolCall(env.DB, toolName, "2026-08-28T12:00:00.000Z");
        await recordMcpToolCall(env.DB, toolName, "2026-08-28T12:01:00.000Z");

        const calls = await listMcpToolCalls(env.DB, toolName);
        expect(calls).toHaveLength(2);
        expect(calls).toEqual([
            {
                id: expect.any(String),
                toolId: calls[0]?.toolId,
                calledAt: "2026-08-28T12:00:00.000Z",
            },
            {
                id: expect.any(String),
                toolId: calls[0]?.toolId,
                calledAt: "2026-08-28T12:01:00.000Z",
            },
        ]);
        expect(calls[0]?.toolId).toEqual(expect.any(String));
    });
});
