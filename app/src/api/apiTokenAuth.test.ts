import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
    apiTokenUsageRefreshMs,
    authenticateApiToken,
    createApiToken,
    listApiTokenRecords,
    revokeApiToken,
} from "../services/apiTokenService";
import { apiApp } from "./app";

const categoriesRequest = (headers: Record<string, string> = {}) =>
    new Request("https://inventia.example/api/categories", { headers });

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

const sha256Hex = async (value: string): Promise<string> => {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value),
    );
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};

describe("API token authentication", () => {
    it("rejects a request without a token", async () => {
        const response = await apiApp.fetch(categoriesRequest(), env);

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: "API_TOKEN_REQUIRED" },
        });
    });

    it("rejects an unknown token", async () => {
        const response = await apiApp.fetch(
            categoriesRequest(
                bearer("inv_0000000000000000000000000000000000000000000"),
            ),
            env,
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: "API_TOKEN_INVALID" },
        });
    });

    it("accepts a valid token and keeps the health check public", async () => {
        const { secret } = await createApiToken(env.DB, { name: "test-app" });

        const authorized = await apiApp.fetch(
            categoriesRequest(bearer(secret)),
            env,
        );
        const health = await apiApp.fetch(
            new Request("https://inventia.example/api/health"),
            env,
        );

        expect(authorized.status).not.toBe(401);
        expect(health.status).toBe(200);
    });

    it("stores only the hash of the issued token", async () => {
        const { token, secret } = await createApiToken(env.DB, {
            name: "hash-check",
        });

        const row = await env.DB.prepare(
            "SELECT token_hash AS tokenHash, token_prefix AS tokenPrefix FROM api_tokens WHERE id = ?",
        )
            .bind(token.id)
            .first<{ tokenHash: string; tokenPrefix: string }>();

        expect(row?.tokenHash).toBe(await sha256Hex(secret));
        expect(row?.tokenHash).not.toBe(secret);
        expect(row?.tokenPrefix).toBe(
            secret.slice(0, token.tokenPrefix.length),
        );
        expect(token.tokenPrefix.length).toBeLessThan(secret.length);
    });

    it("rejects a revoked token", async () => {
        const { token, secret } = await createApiToken(env.DB, {
            name: "revoked",
        });
        await revokeApiToken(env.DB, token.id);

        const response = await apiApp.fetch(
            categoriesRequest(bearer(secret)),
            env,
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: "API_TOKEN_INVALID" },
        });
    });

    it("records the last use at most once per interval", async () => {
        const { token, secret } = await createApiToken(
            env.DB,
            { name: "usage" },
            "2026-09-01T00:00:00.000Z",
        );

        const first = await authenticateApiToken(
            env.DB,
            secret,
            "2026-09-01T00:01:00.000Z",
        );
        const second = await authenticateApiToken(
            env.DB,
            secret,
            "2026-09-01T00:02:00.000Z",
        );
        const third = await authenticateApiToken(
            env.DB,
            secret,
            new Date(
                Date.parse("2026-09-01T00:02:00.000Z") + apiTokenUsageRefreshMs,
            ).toISOString(),
        );
        const stored = (await listApiTokenRecords(env.DB)).find(
            (entry) => entry.id === token.id,
        );

        expect(first?.lastUsedAt).toBe("2026-09-01T00:01:00.000Z");
        expect(second?.lastUsedAt).toBe("2026-09-01T00:01:00.000Z");
        expect(third?.lastUsedAt).not.toBe("2026-09-01T00:01:00.000Z");
        expect(stored?.lastUsedAt).toBe(third?.lastUsedAt);
    });
});
