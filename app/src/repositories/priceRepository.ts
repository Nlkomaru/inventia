import { newId } from "../domain/id";
import type {
    AllPriceRecordCursor,
    NormalizedPriceRecordCreateInput,
    PriceComparisonCursor,
    PriceRecordCursor,
    PriceRecordDimension,
    PriceRecordListInput,
} from "../domain/price";

export interface ItemPricingContext {
    id: string;
    baseUnit: string;
    baseDimension: PriceRecordDimension;
}

export interface PriceRecordRow {
    id: string;
    itemId: string;
    contentAmount: number;
    setCount: number;
    packaging: string | null;
    price: number;
    source: string;
    storeId: string | null;
    storeName: string | null;
    storeFaviconObjectKey: string | null;
    url: string | null;
    recordedAt: string;
    createdAt: string;
    baseUnit: string;
    baseDimension: PriceRecordDimension;
}

export interface PriceComparisonRecordRow extends PriceRecordRow {
    unitPrice: number;
}

/** 全品目の一覧は品目ページの外で読むため、品目名と絵文字も一緒に引く。 */
export interface AllPriceRecordRow extends PriceRecordRow {
    itemName: string;
    itemEmoji: string;
}

export interface PriceRecordListQuery {
    itemId: string;
    limit: number;
    cursor: PriceRecordCursor | null;
}

export interface PriceRecordListResult {
    rows: PriceRecordRow[];
    hasMore: boolean;
}

export interface AllPriceRecordListQuery {
    limit: number;
    cursor: AllPriceRecordCursor | null;
}

export interface AllPriceRecordListResult {
    rows: AllPriceRecordRow[];
    hasMore: boolean;
}

export interface PriceComparisonListQuery {
    itemId: string;
    limit: number;
    cursor: PriceComparisonCursor | null;
}

export interface PriceComparisonListResult {
    rows: PriceComparisonRecordRow[];
    hasMore: boolean;
}

const priceRecordSelect = `
    SELECT
        p.id,
        p.item_id AS itemId,
        p.content_amount AS contentAmount,
        p.set_count AS setCount,
        p.packaging,
        p.price,
        p.source,
        p.store_id AS storeId,
        s.name AS storeName,
        s.favicon_object_key AS storeFaviconObjectKey,
        p.url,
        p.recorded_at AS recordedAt,
        p.created_at AS createdAt,
        i.base_unit AS baseUnit,
        i.base_dimension AS baseDimension
    FROM price_records AS p
    INNER JOIN items AS i ON i.id = p.item_id
    LEFT JOIN stores AS s ON s.id = p.store_id`;

const allPriceRecordSelect = `
    SELECT
        p.id,
        p.item_id AS itemId,
        p.content_amount AS contentAmount,
        p.set_count AS setCount,
        p.packaging,
        p.price,
        p.source,
        p.store_id AS storeId,
        s.name AS storeName,
        s.favicon_object_key AS storeFaviconObjectKey,
        p.url,
        p.recorded_at AS recordedAt,
        p.created_at AS createdAt,
        i.base_unit AS baseUnit,
        i.base_dimension AS baseDimension,
        i.name AS itemName,
        i.emoji AS itemEmoji
    FROM price_records AS p
    INNER JOIN items AS i ON i.id = p.item_id
    LEFT JOIN stores AS s ON s.id = p.store_id`;

// The comparison value is derived from persisted price/package fields. The
// REAL cast avoids integer overflow while keeping the expression aligned with
// calculateUnitPrice in the service layer. A count item's base unit is already
// its smallest unit, so the kg/L factor must stay out of that dimension even
// when the item happens to be labelled 'kg' or 'L'.
const unitPriceExpression = `
    (CAST(p.price AS REAL) /
        (CAST(p.content_amount AS REAL) * CAST(p.set_count AS REAL) *
            CASE
                WHEN i.base_dimension != 'count' AND i.base_unit IN ('kg', 'L')
                THEN 1000.0
                ELSE 1.0
            END)) *
    CASE WHEN i.base_dimension = 'count' THEN 1.0 ELSE 100.0 END`;

const priceRecordComparisonSelect = `
    SELECT
        p.id,
        p.item_id AS itemId,
        p.content_amount AS contentAmount,
        p.set_count AS setCount,
        p.packaging,
        p.price,
        p.source,
        p.store_id AS storeId,
        s.name AS storeName,
        s.favicon_object_key AS storeFaviconObjectKey,
        p.url,
        p.recorded_at AS recordedAt,
        p.created_at AS createdAt,
        i.base_unit AS baseUnit,
        i.base_dimension AS baseDimension,
        ${unitPriceExpression} AS unitPrice
    FROM price_records AS p
    INNER JOIN items AS i ON i.id = p.item_id
    LEFT JOIN stores AS s ON s.id = p.store_id`;

export const findItemPricingContext = async (
    db: D1Database,
    itemId: string,
): Promise<ItemPricingContext | null> =>
    db
        .prepare(
            `SELECT id, base_unit AS baseUnit, base_dimension AS baseDimension
             FROM items WHERE id = ?1 LIMIT 1`,
        )
        .bind(itemId)
        .first<ItemPricingContext>();

/**
 * Whether the item holds at least one price record. Only the existence matters
 * to the callers, so the row itself is never read.
 */
export const itemHasPriceRecords = async (
    db: D1Database,
    itemId: string,
): Promise<boolean> => {
    const row = await db
        .prepare(
            `SELECT EXISTS (SELECT 1 FROM price_records WHERE item_id = ?1)
             AS present`,
        )
        .bind(itemId)
        .first<{ present: number }>();
    return (row?.present ?? 0) === 1;
};

export const findPriceRecordById = async (
    db: D1Database,
    id: string,
): Promise<PriceRecordRow | null> =>
    db
        .prepare(`${priceRecordSelect} WHERE p.id = ?1 LIMIT 1`)
        .bind(id)
        .first<PriceRecordRow>();

export const listPriceRecords = async (
    db: D1Database,
    query: PriceRecordListQuery,
): Promise<PriceRecordListResult> => {
    const cursorClause = query.cursor
        ? "AND (p.recorded_at < ?2 OR (p.recorded_at = ?2 AND p.id < ?3))"
        : "";
    const statement = query.cursor
        ? db
              .prepare(
                  `${priceRecordSelect}
                   WHERE p.item_id = ?1
                   ${cursorClause}
                   ORDER BY p.recorded_at DESC, p.id DESC
                   LIMIT ?4`,
              )
              .bind(
                  query.itemId,
                  query.cursor.recordedAt,
                  query.cursor.id,
                  query.limit + 1,
              )
        : db
              .prepare(
                  `${priceRecordSelect}
                   WHERE p.item_id = ?1
                   ORDER BY p.recorded_at DESC, p.id DESC
                   LIMIT ?2`,
              )
              .bind(query.itemId, query.limit + 1);
    const result = await statement.all<PriceRecordRow>();
    const rows = result.results;
    return {
        rows: rows.slice(0, query.limit),
        hasMore: rows.length > query.limit,
    };
};

/**
 * 品目を跨いだ価格記録の一覧。並びは記録日時の新しい順で、
 * idx_price_records_recorded_at(recorded_at, id) がそのまま cursor の key になる。
 */
export const listAllPriceRecords = async (
    db: D1Database,
    query: AllPriceRecordListQuery,
): Promise<AllPriceRecordListResult> => {
    const statement = query.cursor
        ? db
              .prepare(
                  `${allPriceRecordSelect}
                   WHERE (p.recorded_at < ?1 OR (p.recorded_at = ?1 AND p.id < ?2))
                   ORDER BY p.recorded_at DESC, p.id DESC
                   LIMIT ?3`,
              )
              .bind(query.cursor.recordedAt, query.cursor.id, query.limit + 1)
        : db
              .prepare(
                  `${allPriceRecordSelect}
                   ORDER BY p.recorded_at DESC, p.id DESC
                   LIMIT ?1`,
              )
              .bind(query.limit + 1);
    const result = await statement.all<AllPriceRecordRow>();
    const rows = result.results;
    return {
        rows: rows.slice(0, query.limit),
        hasMore: rows.length > query.limit,
    };
};

export const listPriceRecordsByUnitPrice = async (
    db: D1Database,
    query: PriceComparisonListQuery,
): Promise<PriceComparisonListResult> => {
    const cursorClause = query.cursor
        ? `AND (${unitPriceExpression} > ?2 OR
                 (${unitPriceExpression} = ?2 AND p.id > ?3))`
        : "";
    const statement = query.cursor
        ? db
              .prepare(
                  `${priceRecordComparisonSelect}
                   WHERE p.item_id = ?1
                   ${cursorClause}
                   ORDER BY ${unitPriceExpression} ASC, p.id ASC
                   LIMIT ?4`,
              )
              .bind(
                  query.itemId,
                  query.cursor.unitPrice,
                  query.cursor.id,
                  query.limit + 1,
              )
        : db
              .prepare(
                  `${priceRecordComparisonSelect}
                   WHERE p.item_id = ?1
                   ORDER BY ${unitPriceExpression} ASC, p.id ASC
                   LIMIT ?2`,
              )
              .bind(query.itemId, query.limit + 1);
    const result = await statement.all<PriceComparisonRecordRow>();
    const rows = result.results;
    return {
        rows: rows.slice(0, query.limit),
        hasMore: rows.length > query.limit,
    };
};

/**
 * 価格履歴を 1 件追加する。`purchaseId` を渡すと購入明細として購入イベントへ紐付く
 * （レシート適用など）。渡さない場合は価格観測のみの行になる。
 */
export const insertPriceRecord = async (
    db: D1Database,
    input: NormalizedPriceRecordCreateInput & {
        purchaseId?: string | null;
        source: string;
    },
): Promise<PriceRecordRow> => {
    const id = newId();
    const createdAt = new Date().toISOString();
    await db
        .prepare(
            `INSERT INTO price_records
                (id, item_id, purchase_id, content_amount, set_count, packaging, price,
                 source, store_id, url, recorded_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        .bind(
            id,
            input.itemId,
            input.purchaseId ?? null,
            input.contentAmount,
            input.setCount,
            input.packaging ?? null,
            input.price,
            input.source,
            input.storeId ?? null,
            input.url ?? null,
            input.recordedAt,
            createdAt,
        )
        .run();
    const inserted = await findPriceRecordById(db, id);
    if (!inserted) {
        throw new Error("Inserted price record could not be read back");
    }
    return inserted;
};

export type { PriceRecordListInput };
