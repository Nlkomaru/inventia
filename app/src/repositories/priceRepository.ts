import { newId } from "../domain/id";
import type {
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
    url: string | null;
    recordedAt: string;
    createdAt: string;
    baseUnit: string;
    baseDimension: PriceRecordDimension;
}

export interface PriceComparisonRecordRow extends PriceRecordRow {
    unitPrice: number;
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
        p.url,
        p.recorded_at AS recordedAt,
        p.created_at AS createdAt,
        i.base_unit AS baseUnit,
        i.base_dimension AS baseDimension
    FROM price_records AS p
    INNER JOIN items AS i ON i.id = p.item_id`;

// The comparison value is derived from persisted price/package fields. The
// REAL cast avoids integer overflow while keeping the expression aligned with
// calculateUnitPrice in the service layer.
const unitPriceExpression = `
    (CAST(p.price AS REAL) /
        (CAST(p.content_amount AS REAL) * CAST(p.set_count AS REAL) *
            CASE WHEN i.base_unit IN ('kg', 'L') THEN 1000.0 ELSE 1.0 END)) *
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
        p.url,
        p.recorded_at AS recordedAt,
        p.created_at AS createdAt,
        i.base_unit AS baseUnit,
        i.base_dimension AS baseDimension,
        ${unitPriceExpression} AS unitPrice
    FROM price_records AS p
    INNER JOIN items AS i ON i.id = p.item_id`;

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

export const insertPriceRecord = async (
    db: D1Database,
    input: NormalizedPriceRecordCreateInput,
): Promise<PriceRecordRow> => {
    const id = newId();
    const createdAt = new Date().toISOString();
    await db
        .prepare(
            `INSERT INTO price_records
                (id, item_id, content_amount, set_count, packaging, price,
                 source, url, recorded_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        )
        .bind(
            id,
            input.itemId,
            input.contentAmount,
            input.setCount,
            input.packaging ?? null,
            input.price,
            input.source,
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
