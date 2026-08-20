import type { ExternalProviderId } from "../domain/externalProvider";

export interface ExternalProviderRow {
    id: string;
    name: string;
    faviconUrl: string | null;
    url: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface NewExternalProviderRecord {
    id: string;
    name: string;
    faviconUrl: string | null;
    url: string | null;
    createdAt: string;
    updatedAt: string;
}

const externalProviderSelect = `
    SELECT
        id,
        name,
        favicon_url AS faviconUrl,
        url,
        created_at AS createdAt,
        updated_at AS updatedAt
    FROM external_providers`;

export const findExternalProviderById = async (
    db: D1Database,
    id: ExternalProviderId,
): Promise<ExternalProviderRow | null> =>
    db
        .prepare(`${externalProviderSelect} WHERE id = ?1 LIMIT 1`)
        .bind(id)
        .first<ExternalProviderRow>();

export const findExternalProviderByName = async (
    db: D1Database,
    name: string,
): Promise<ExternalProviderRow | null> =>
    db
        .prepare(`${externalProviderSelect} WHERE name = ?1 LIMIT 1`)
        .bind(name)
        .first<ExternalProviderRow>();

/**
 * 連携先はマスタとして件数が限られるため cursor を持たず名前順で返す。
 * limit は暴走しないための保険で、超えた分は一覧に現れない。HTTP と MCP の
 * description にも「先頭 200 件まで」と書き、打ち切りを契約に含めている。
 */
export const listExternalProviders = async (
    db: D1Database,
    limit = 200,
): Promise<ExternalProviderRow[]> => {
    const result = await db
        .prepare(`${externalProviderSelect} ORDER BY name ASC, id ASC LIMIT ?1`)
        .bind(limit)
        .all<ExternalProviderRow>();
    return result.results;
};

export const insertExternalProvider = async (
    db: D1Database,
    record: NewExternalProviderRecord,
): Promise<ExternalProviderRow> => {
    await db
        .prepare(
            `INSERT INTO external_providers
                (id, name, favicon_url, url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(
            record.id,
            record.name,
            record.faviconUrl,
            record.url,
            record.createdAt,
            record.updatedAt,
        )
        .run();
    const inserted = await findExternalProviderById(db, record.id);
    if (!inserted) {
        throw new Error("Inserted external provider could not be read back");
    }
    return inserted;
};

export const updateExternalProvider = async (
    db: D1Database,
    id: ExternalProviderId,
    changes: {
        name?: string;
        faviconUrl?: string | null;
        url?: string | null;
    },
    updatedAt: string,
): Promise<ExternalProviderRow | null> => {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (changes.name !== undefined) {
        assignments.push("name = ?");
        values.push(changes.name);
    }
    if (changes.faviconUrl !== undefined) {
        assignments.push("favicon_url = ?");
        values.push(changes.faviconUrl);
    }
    if (changes.url !== undefined) {
        assignments.push("url = ?");
        values.push(changes.url);
    }
    assignments.push("updated_at = ?");
    values.push(updatedAt, id);

    await db
        .prepare(
            `UPDATE external_providers
             SET ${assignments.join(", ")}
             WHERE id = ?`,
        )
        .bind(...values)
        .run();
    return findExternalProviderById(db, id);
};

export const deleteExternalProvider = async (
    db: D1Database,
    id: ExternalProviderId,
): Promise<boolean> => {
    const result = await db
        .prepare("DELETE FROM external_providers WHERE id = ?1")
        .bind(id)
        .run();
    return (result.meta.changes ?? 0) > 0;
};

/** stock_movements は ON DELETE RESTRICT で連携先を参照する。 */
export const countStockMovementsByExternalProvider = async (
    db: D1Database,
    id: ExternalProviderId,
): Promise<number> => {
    const row = await db
        .prepare(
            "SELECT count(*) AS total FROM stock_movements WHERE external_provider_id = ?1",
        )
        .bind(id)
        .first<{ total: number }>();
    return row?.total ?? 0;
};

export const externalProviderRepository = {
    findExternalProviderById,
    findExternalProviderByName,
    listExternalProviders,
    insertExternalProvider,
    updateExternalProvider,
    deleteExternalProvider,
    countStockMovementsByExternalProvider,
};
