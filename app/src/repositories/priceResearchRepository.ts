import { newId } from "../domain/id";
import type { PriceRecordDimension } from "../domain/price";
import type {
    PriceResearchCursor,
    PriceResearchStatus,
} from "../domain/priceResearch";

export interface PriceResearchRequestRow {
    id: string;
    status: PriceResearchStatus;
    itemId: string | null;
    requestedItemName: string;
    requestedUnit: string | null;
    purpose: string | null;
    note: string | null;
    requestedBy: string | null;
    priceRecordId: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
    itemName: string | null;
    itemBaseUnit: string | null;
    itemBaseDimension: PriceRecordDimension | null;
    prPrice: number | null;
    prContentAmount: number | null;
    prSetCount: number | null;
    prBaseUnit: string | null;
    prBaseDimension: PriceRecordDimension | null;
    prStoreId: string | null;
    prStoreName: string | null;
    prSource: string | null;
    prPackaging: string | null;
    prUrl: string | null;
    prRecordedAt: string | null;
}

export interface PriceResearchInsertInput {
    itemId: string | null;
    requestedItemName: string;
    requestedUnit: string | null;
    purpose: string | null;
    note: string | null;
    requestedBy: string | null;
}

export interface PriceResearchListRepoQuery {
    status?: PriceResearchStatus;
    limit: number;
    cursor: PriceResearchCursor | null;
}

export interface PriceResearchListRepoResult {
    rows: PriceResearchRequestRow[];
    hasMore: boolean;
}

const priceResearchSelect = `
    SELECT
        r.id,
        r.status,
        r.item_id AS itemId,
        r.requested_item_name AS requestedItemName,
        r.requested_unit AS requestedUnit,
        r.purpose,
        r.note,
        r.requested_by AS requestedBy,
        r.price_record_id AS priceRecordId,
        r.completed_at AS completedAt,
        r.created_at AS createdAt,
        r.updated_at AS updatedAt,
        i.name AS itemName,
        i.base_unit AS itemBaseUnit,
        i.base_dimension AS itemBaseDimension,
        p.price AS prPrice,
        p.content_amount AS prContentAmount,
        p.set_count AS prSetCount,
        pi.base_unit AS prBaseUnit,
        pi.base_dimension AS prBaseDimension,
        p.store_id AS prStoreId,
        s.name AS prStoreName,
        p.source AS prSource,
        p.packaging AS prPackaging,
        p.url AS prUrl,
        p.recorded_at AS prRecordedAt
    FROM price_research_requests AS r
    LEFT JOIN items AS i ON i.id = r.item_id
    LEFT JOIN price_records AS p ON p.id = r.price_record_id
    LEFT JOIN items AS pi ON pi.id = p.item_id
    LEFT JOIN stores AS s ON s.id = p.store_id`;

export const findPriceResearchRequestById = async (
    db: D1Database,
    id: string,
): Promise<PriceResearchRequestRow | null> =>
    db
        .prepare(`${priceResearchSelect} WHERE r.id = ?1 LIMIT 1`)
        .bind(id)
        .first<PriceResearchRequestRow>();

export const insertPriceResearchRequest = async (
    db: D1Database,
    input: PriceResearchInsertInput,
): Promise<PriceResearchRequestRow> => {
    const id = newId();
    const now = new Date().toISOString();
    await db
        .prepare(
            `INSERT INTO price_research_requests (
                id, status, item_id, requested_item_name, requested_unit,
                purpose, note, requested_by, created_at, updated_at
            ) VALUES (?1, 'pending', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(
            id,
            input.itemId,
            input.requestedItemName,
            input.requestedUnit,
            input.purpose,
            input.note,
            input.requestedBy,
            now,
            now,
        )
        .run();
    const created = await findPriceResearchRequestById(db, id);
    if (!created) {
        throw new Error("Created price research request could not be reloaded");
    }
    return created;
};

export const listPriceResearchRequests = async (
    db: D1Database,
    query: PriceResearchListRepoQuery,
): Promise<PriceResearchListRepoResult> => {
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (query.status !== undefined) {
        bindings.push(query.status);
        conditions.push(`r.status = ?${bindings.length}`);
    }

    if (query.cursor !== null) {
        bindings.push(query.cursor.createdAt, query.cursor.id);
        const createdAtParam = `?${bindings.length - 1}`;
        const idParam = `?${bindings.length}`;
        conditions.push(
            `(r.created_at < ${createdAtParam} OR (r.created_at = ${createdAtParam} AND r.id < ${idParam}))`,
        );
    }

    const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    bindings.push(query.limit + 1);
    const limitParam = `?${bindings.length}`;

    const result = await db
        .prepare(
            `${priceResearchSelect}
             ${whereClause}
             ORDER BY r.created_at DESC, r.id DESC
             LIMIT ${limitParam}`,
        )
        .bind(...bindings)
        .all<PriceResearchRequestRow>();

    const rows = result.results;
    const hasMore = rows.length > query.limit;
    return {
        rows: hasMore ? rows.slice(0, query.limit) : rows,
        hasMore,
    };
};

export const markPriceResearchCompleted = async (
    db: D1Database,
    id: string,
    input: {
        itemId: string;
        priceRecordId: string;
        completedAt: string;
    },
): Promise<PriceResearchRequestRow | null> => {
    const now = new Date().toISOString();
    const result = await db
        .prepare(
            `UPDATE price_research_requests
             SET status = 'completed',
                 item_id = ?1,
                 price_record_id = ?2,
                 completed_at = ?3,
                 updated_at = ?4
             WHERE id = ?5 AND status = 'pending'`,
        )
        .bind(input.itemId, input.priceRecordId, input.completedAt, now, id)
        .run();

    if ((result.meta.changes ?? 0) === 0) {
        return null;
    }
    return findPriceResearchRequestById(db, id);
};

export const markPriceResearchCancelled = async (
    db: D1Database,
    id: string,
): Promise<PriceResearchRequestRow | null> => {
    const now = new Date().toISOString();
    const result = await db
        .prepare(
            `UPDATE price_research_requests
             SET status = 'cancelled',
                 updated_at = ?1
             WHERE id = ?2 AND status = 'pending'`,
        )
        .bind(now, id)
        .run();

    if ((result.meta.changes ?? 0) === 0) {
        return null;
    }
    return findPriceResearchRequestById(db, id);
};
