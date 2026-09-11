import { createServerFn } from "@tanstack/react-start";
import type { ApiToken, IssuedApiToken } from "@/domain/apiToken";

/** API トークンの発行・一覧・失効。画面から service を直接呼ぶ */

export const listApiTokens = createServerFn({ method: "GET" }).handler(
    async (): Promise<ApiToken[]> => {
        const [{ env }, { listApiTokenRecords }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/apiTokenService"),
        ]);
        return listApiTokenRecords(env.DB);
    },
);

export const createApiToken = createServerFn({ method: "POST" })
    .inputValidator((data: { name: string }) => data)
    .handler(async ({ data }): Promise<IssuedApiToken> => {
        const [{ env }, { createApiToken: issue, ApiTokenServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/apiTokenService"),
            ]);
        try {
            return await issue(env.DB, data);
        } catch (error) {
            if (error instanceof ApiTokenServiceError) {
                throw new Error(error.message);
            }
            throw new Error("API トークンを発行できませんでした。");
        }
    });

export const revokeApiToken = createServerFn({ method: "POST" })
    .inputValidator((data: { id: string }) => data)
    .handler(async ({ data }): Promise<ApiToken> => {
        const [{ env }, { revokeApiToken: revoke, ApiTokenServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/apiTokenService"),
            ]);
        try {
            return await revoke(env.DB, data.id);
        } catch (error) {
            if (error instanceof ApiTokenServiceError) {
                throw new Error(error.message);
            }
            throw new Error("API トークンを失効できませんでした。");
        }
    });
