import type { MiddlewareHandler } from "hono";
import { authenticateApiToken } from "../services/apiTokenService";
import { isSignedImageRequest } from "../services/signedImageUrlService";
import type { ApiBindings } from "./bindings";

/**
 * HTTP API と MCP を API トークンで認証する。
 *
 * Cloudflare Access を /api で無効にしても安全に使えるように、/api/* は
 * Bearer トークンを必須にする。ヘルスチェックと API ドキュメントだけは、
 * 外形監視と仕様確認のためにトークン無しで通す。店舗ファビコンとレシート写真の
 * GET はブラウザの <img> がヘッダーを付けられないため、URL の署名で通す。
 */

const publicPaths: readonly string[] = [
    "/api/health",
    "/api/openapi",
    "/api/scalar",
];

const errorBody = (code: string, message: string) => ({
    error: { code, message },
});

export const apiTokenAuth: MiddlewareHandler<ApiBindings> = async (c, next) => {
    if (
        publicPaths.includes(new URL(c.req.url).pathname) ||
        isSignedImageRequest(c.env, c.req.raw)
    ) {
        return next();
    }

    const header = c.req.header("authorization") ?? "";
    const secret = header.startsWith("Bearer ")
        ? header.slice("Bearer ".length).trim()
        : "";
    if (secret.length === 0) {
        return c.json(
            errorBody(
                "API_TOKEN_REQUIRED",
                "Authorization: Bearer <API トークン> が必要です。設定の「API トークン」で発行してください。",
            ),
            401,
        );
    }

    const token = await authenticateApiToken(c.env.DB, secret);
    if (!token) {
        return c.json(
            errorBody(
                "API_TOKEN_INVALID",
                "API トークンが無効か、失効しています。",
            ),
            401,
        );
    }

    return next();
};
