import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
    type OpenRouterChatModelList,
    type OpenRouterIntegrationStatus,
    type OpenRouterIntegrationUpdate,
    openRouterIntegrationStatusSchema,
} from "@/domain/integration";

const apiErrorSchema = z.object({
    error: z.object({ message: z.string() }),
});

const readApiError = async (response: Response): Promise<string> => {
    const body: unknown = await response.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
        return parsed.data.error.message;
    }
    return "連携設定を保存できませんでした。";
};

export const getOpenRouterStatus = createServerFn({ method: "GET" }).handler(
    async (): Promise<OpenRouterIntegrationStatus> => {
        const [{ env }, { getOpenRouterIntegrationStatus }] = await Promise.all(
            [
                import("cloudflare:workers"),
                import("@/services/integrationService"),
            ],
        );
        return getOpenRouterIntegrationStatus(env.DB);
    },
);

export const listOpenRouterModels = createServerFn({ method: "GET" }).handler(
    async (): Promise<OpenRouterChatModelList> => {
        const [{ env }, { listOpenRouterVisionModels }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/integrationService"),
        ]);
        try {
            return await listOpenRouterVisionModels(
                env.DB,
                env.SETTINGS_ENCRYPTION_KEY,
            );
        } catch {
            // 上流 (OpenRouter) の失敗はそのまま返さず、利用者向けの安定した文言へ変換する。
            throw new Error(
                "OpenRouter からモデル一覧を取得できませんでした。時間をおいて再試行してください。",
            );
        }
    },
);

export const updateOpenRouterIntegration = async (
    input: OpenRouterIntegrationUpdate,
): Promise<OpenRouterIntegrationStatus> => {
    const response = await fetch("/api/settings/integrations/openrouter", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
    });
    if (!response.ok) {
        throw new Error(await readApiError(response));
    }
    const parsed = openRouterIntegrationStatusSchema.safeParse(
        await response.json(),
    );
    if (!parsed.success) {
        throw new Error("連携設定の応答を確認できませんでした。");
    }
    return parsed.data;
};
