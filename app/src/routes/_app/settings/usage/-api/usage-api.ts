import { createServerFn } from "@tanstack/react-start";
import type { McpUsageSummary } from "@/domain/usage";

// /api は API トークン必須のため、画面は HTTP を経由せず service を直接呼ぶ。
export const getMcpUsage = createServerFn({ method: "GET" }).handler(
    async (): Promise<McpUsageSummary> => {
        const [{ env }, { getMcpUsage: readUsage, McpUsageServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/mcpUsageService"),
            ]);
        try {
            return await readUsage(env.DB);
        } catch (error) {
            if (error instanceof McpUsageServiceError) {
                throw new Error(error.message);
            }
            throw new Error("MCP の利用量を取得できませんでした。");
        }
    },
);
