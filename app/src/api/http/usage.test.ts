import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { mcpUsageSummarySchema } from "../../domain/usage";
import { recordMcpToolCall } from "../../repositories/mcpToolUsageRepository";
import { apiApp } from "../app";

describe("MCP usage API", () => {
    it("returns grouped usage without call payload fields", async () => {
        const toolName = `usage-api-${crypto.randomUUID()}`;
        await recordMcpToolCall(env.DB, toolName, "2026-08-28T13:00:00.000Z");

        const response = await apiApp.fetch(
            new Request("https://inventia.test/api/settings/usage/mcp"),
            env,
        );
        expect(response.status).toBe(200);
        const body: unknown = await response.json();
        const usage = mcpUsageSummarySchema.parse(body);
        const tool = usage.tools.find((entry) => entry.name === toolName);

        expect(tool?.callCount).toBe(1);
        expect(
            usage.recentCalls.find((entry) => entry.toolName === toolName),
        ).toMatchObject({
            toolName,
            calledAt: "2026-08-28T13:00:00.000Z",
        });
        expect(JSON.stringify(body)).not.toContain("payload");
        expect(JSON.stringify(body)).not.toContain("response");
    });
});
