import { createServerFn } from "@tanstack/react-start";
import type {
    OpenRouterChatModelList,
    OpenRouterIntegrationStatus,
    OpenRouterIntegrationUpdate,
    OpenRouterUsageSummary,
} from "@/domain/integration";

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

// /api は API トークン必須のため、画面は HTTP を経由せず service を直接呼ぶ。
// これで Cloudflare Access を /api で無効にしても設定画面が動く。
export const getOpenRouterUsage = createServerFn({ method: "GET" }).handler(
    async (): Promise<OpenRouterUsageSummary> => {
        const [
            { env },
            { getOpenRouterUsage: readUsage, IntegrationServiceError },
        ] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/integrationService"),
        ]);
        try {
            return await readUsage(env);
        } catch (error) {
            if (error instanceof IntegrationServiceError) {
                throw new Error(error.message);
            }
            throw new Error("OpenRouter の利用量を取得できませんでした。");
        }
    },
);

export const updateOpenRouterIntegration = createServerFn({
    method: "POST",
})
    .inputValidator((data: OpenRouterIntegrationUpdate) => data)
    .handler(async ({ data }): Promise<OpenRouterIntegrationStatus> => {
        const [
            { env },
            { updateOpenRouterIntegration: update, IntegrationServiceError },
        ] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/integrationService"),
        ]);
        try {
            return await update(env.DB, env.SETTINGS_ENCRYPTION_KEY, data);
        } catch (error) {
            if (error instanceof IntegrationServiceError) {
                throw new Error(error.message);
            }
            throw new Error("連携設定を保存できませんでした。");
        }
    });
