import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { mcpUsagePeriodDays } from "../domain/usage";
import { recordMcpToolCall } from "../repositories/mcpToolUsageRepository";
import { getMcpUsage } from "./mcpUsageService";

describe("MCP usage service", () => {
    it("groups canonical tools and fills the complete UTC activity period", async () => {
        const toolName = `usage-service-${crypto.randomUUID()}`;
        await recordMcpToolCall(env.DB, toolName, "2026-08-01T12:00:00.000Z");
        await recordMcpToolCall(env.DB, toolName, "2026-08-28T12:00:00.000Z");

        const usage = await getMcpUsage(
            env.DB,
            new Date("2026-08-28T12:30:00.000Z"),
        );
        const tool = usage.tools.find((entry) => entry.name === toolName);

        expect(tool).toMatchObject({
            name: toolName,
            callCount: 2,
            lastCalledAt: "2026-08-28T12:00:00.000Z",
        });
        expect(
            usage.recentCalls.find((entry) => entry.toolName === toolName),
        ).toMatchObject({
            toolName,
            calledAt: "2026-08-28T12:00:00.000Z",
        });
        expect(usage.activity).toHaveLength(mcpUsagePeriodDays);
        expect(
            usage.activity.find((entry) => entry.date === "2026-08-28"),
        ).toEqual({ date: "2026-08-28", callCount: 1 });
        expect(
            usage.activity.find((entry) => entry.date === "2026-08-27"),
        ).toEqual({ date: "2026-08-27", callCount: 0 });
    });
});
