import type { StoreCursor, StoreId } from "../domain/store";

export interface StoreRow {
    id: string;
    name: string;
    url: string | null;
    faviconObjectKey: string | null;
    faviconContentType: string | null;
    faviconByteSize: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface StoreListQuery {
    /** 店名の部分一致で絞る検索語。絞り込まない場合は null。 */
    q: string | null;
    limit: number;
    cursor: StoreCursor | null;
}

export interface StoreListResult {
    rows: StoreRow[];
    hasMore: boolean;
}

export interface NewStoreRecord {
    id: string;
    name: string;
    url: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface StoreFaviconWrite {
    objectKey: string;
    contentType: string;
    byteSize: number;
}

const storeSelect = `
    SELECT
        id,
        name,
        url,
        favicon_object_key AS faviconObjectKey,
        favicon_content_type AS faviconContentType,
        favicon_byte_size AS faviconByteSize,
        created_at AS createdAt,
        updated_at AS updatedAt
    FROM stores`;

// LIKE のワイルドカードとエスケープ文字自体を無効化し、検索語を literal として扱う
// （場所名検索と同じ規則）
const escapeLike = (value: string): string =>
    value
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_");

export const findStoreById = async (
    db: D1Database,
    id: StoreId,
): Promise<StoreRow | null> =>
    db
        .prepare(`${storeSelect} WHERE id = ?1 LIMIT 1`)
        .bind(id)
        .first<StoreRow>();

export const findStoreByName = async (
    db: D1Database,
    name: string,
): Promise<StoreRow | null> =>
    db
        .prepare(`${storeSelect} WHERE name = ?1 LIMIT 1`)
        .bind(name)
        .first<StoreRow>();

export const listStores = async (
    db: D1Database,
    query: StoreListQuery,
): Promise<StoreListResult> => {
    const result = await db
        .prepare(
            `${storeSelect}
             WHERE (
                     ?1 IS NULL
                     OR name > ?1
                     OR (name = ?1 AND id > ?2)
                 )
                 AND (?3 IS NULL OR name LIKE ?3 ESCAPE char(92) COLLATE NOCASE)
             ORDER BY name ASC, id ASC
             LIMIT ?4`,
        )
        .bind(
            query.cursor?.name ?? null,
            query.cursor?.id ?? null,
            query.q === null ? null : `%${escapeLike(query.q)}%`,
            query.limit + 1,
        )
        .all<StoreRow>();
    const rows = result.results;
    return {
        rows: rows.slice(0, query.limit),
        hasMore: rows.length > query.limit,
    };
};

/** 価格一覧の N+1 を避けるため、必要な店舗をまとめて 1 クエリで読む。 */
/**
 * 正規化した名前で突き合わせるための一覧。店舗は品目と違い数が限られるため
 * 全件をメモリへ載せる。上限は暴走しないための保険で、超えた分は照合対象外になる。
 */
export const listStoresForMatching = async (
    db: D1Database,
    limit = 1_000,
): Promise<StoreRow[]> => {
    const result = await db
        .prepare(`${storeSelect} ORDER BY name ASC, id ASC LIMIT ?1`)
        .bind(limit)
        .all<StoreRow>();
    return result.results;
};

export const listStoresByIds = async (
    db: D1Database,
    ids: readonly string[],
): Promise<StoreRow[]> => {
    if (ids.length === 0) {
        return [];
    }
    const placeholders = ids.map((_, index) => `?${index + 1}`).join(", ");
    const result = await db
        .prepare(`${storeSelect} WHERE id IN (${placeholders})`)
        .bind(...ids)
        .all<StoreRow>();
    return result.results;
};

export const insertStore = async (
    db: D1Database,
    record: NewStoreRecord,
): Promise<StoreRow> => {
    await db
        .prepare(
            `INSERT INTO stores
                (id, name, url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(
            record.id,
            record.name,
            record.url,
            record.createdAt,
            record.updatedAt,
        )
        .run();
    const inserted = await findStoreById(db, record.id);
    if (!inserted) {
        throw new Error("Inserted store could not be read back");
    }
    return inserted;
};

export const updateStore = async (
    db: D1Database,
    id: StoreId,
    changes: { name?: string; url?: string | null },
    updatedAt: string,
): Promise<StoreRow | null> => {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (changes.name !== undefined) {
        assignments.push("name = ?");
        values.push(changes.name);
    }
    if (changes.url !== undefined) {
        assignments.push("url = ?");
        values.push(changes.url);
    }
    assignments.push("updated_at = ?");
    values.push(updatedAt, id);

    await db
        .prepare(
            `UPDATE stores
             SET ${assignments.join(", ")}
             WHERE id = ?`,
        )
        .bind(...values)
        .run();
    return findStoreById(db, id);
};

/**
 * ファビコンの 3 列をまとめて書き換える。`favicon` が null なら 3 列とも消す
 * （CHECK 制約により部分的な更新は許されない）。
 */
export const updateStoreFavicon = async (
    db: D1Database,
    id: StoreId,
    favicon: StoreFaviconWrite | null,
    updatedAt: string,
): Promise<StoreRow | null> => {
    await db
        .prepare(
            `UPDATE stores
             SET favicon_object_key = ?1,
                 favicon_content_type = ?2,
                 favicon_byte_size = ?3,
                 updated_at = ?4
             WHERE id = ?5`,
        )
        .bind(
            favicon?.objectKey ?? null,
            favicon?.contentType ?? null,
            favicon?.byteSize ?? null,
            updatedAt,
            id,
        )
        .run();
    return findStoreById(db, id);
};

export const deleteStore = async (
    db: D1Database,
    id: StoreId,
): Promise<boolean> => {
    const result = await db
        .prepare("DELETE FROM stores WHERE id = ?1")
        .bind(id)
        .run();
    return (result.meta.changes ?? 0) > 0;
};

/** price_records は ON DELETE RESTRICT で店舗を参照する。 */
export const countPriceRecordsByStore = async (
    db: D1Database,
    id: StoreId,
): Promise<number> => {
    const row = await db
        .prepare(
            "SELECT count(*) AS total FROM price_records WHERE store_id = ?1",
        )
        .bind(id)
        .first<{ total: number }>();
    return row?.total ?? 0;
};

export const storeRepository = {
    findStoreById,
    findStoreByName,
    listStores,
    listStoresByIds,
    listStoresForMatching,
    insertStore,
    updateStore,
    updateStoreFavicon,
    deleteStore,
    countPriceRecordsByStore,
};
