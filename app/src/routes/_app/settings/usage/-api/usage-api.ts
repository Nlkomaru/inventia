import { z } from "zod";
import { type McpUsageSummary, mcpUsageSummarySchema } from "@/domain/usage";

const apiErrorSchema = z.object({
    error: z.object({ message: z.string() }),
});

export const getMcpUsage = async (): Promise<McpUsageSummary> => {
    const response = await fetch("/api/settings/usage/mcp");
    if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const parsed = apiErrorSchema.safeParse(body);
        throw new Error(
            parsed.success
                ? parsed.data.error.message
                : "MCP の利用量を取得できませんでした。",
        );
    }
    const parsed = mcpUsageSummarySchema.safeParse(await response.json());
    if (!parsed.success) {
        throw new Error("MCP の利用量の応答を確認できませんでした。");
    }
    return parsed.data;
};
