import { env } from "cloudflare:test";
import { createApiToken } from "../services/apiTokenService";

/**
 * API のテストで使う Authorization ヘッダー。トークンを 1 つ発行して返す。
 * /api/* はトークン必須なので、HTTP を叩くテストはこれを通す。
 */
export const createTestAuthHeaders = async (
    name: string = `test-${crypto.randomUUID()}`,
): Promise<Record<string, string>> => {
    const { secret } = await createApiToken(env.DB, { name });
    return { authorization: `Bearer ${secret}` };
};
