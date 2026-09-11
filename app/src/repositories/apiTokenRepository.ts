import type { ApiToken } from "../domain/apiToken";

/** API トークンの永続化。トークン本体は保存せず、ハッシュだけを扱う */

export interface ApiTokenRow extends ApiToken {
    readonly tokenHash: string;
}

export const insertApiToken = async (
    db: D1Database,
    row: ApiTokenRow,
): Promise<void> => {
    await db
        .prepare(
            `INSERT INTO api_tokens (id, name, token_prefix, token_hash, created_at, last_used_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            row.id,
            row.name,
            row.tokenPrefix,
            row.tokenHash,
            row.createdAt,
            row.lastUsedAt,
            row.revokedAt,
        )
        .run();
};

const toApiToken = (row: ApiTokenRow): ApiToken => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
});

export const listApiTokens = async (db: D1Database): Promise<ApiToken[]> =>
    (
        await db
            .prepare(
                `SELECT id, name, token_prefix AS tokenPrefix, token_hash AS tokenHash,
                        created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
                 FROM api_tokens
                 ORDER BY created_at DESC, id DESC`,
            )
            .all<ApiTokenRow>()
    ).results.map(toApiToken);

export const findApiTokenByHash = async (
    db: D1Database,
    tokenHash: string,
): Promise<ApiTokenRow | null> =>
    db
        .prepare(
            `SELECT id, name, token_prefix AS tokenPrefix, token_hash AS tokenHash,
                    created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
             FROM api_tokens
             WHERE token_hash = ?`,
        )
        .bind(tokenHash)
        .first<ApiTokenRow>();

export const findApiTokenById = async (
    db: D1Database,
    id: string,
): Promise<ApiToken | null> => {
    const row = await db
        .prepare(
            `SELECT id, name, token_prefix AS tokenPrefix, token_hash AS tokenHash,
                    created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
             FROM api_tokens
             WHERE id = ?`,
        )
        .bind(id)
        .first<ApiTokenRow>();
    return row ? toApiToken(row) : null;
};

export const touchApiTokenUsedAt = async (
    db: D1Database,
    id: string,
    usedAt: string,
): Promise<void> => {
    await db
        .prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?")
        .bind(usedAt, id)
        .run();
};

export const revokeApiTokenById = async (
    db: D1Database,
    id: string,
    revokedAt: string,
): Promise<void> => {
    await db
        .prepare(
            "UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        )
        .bind(revokedAt, id)
        .run();
};
