import { newId } from "../domain/id";
import {
    type StockHistoryQuery,
    type StockMovementReason,
    type StockOperationKind,
    stockMovementReasons,
    stockOccurredAtSchema,
} from "../domain/stock";

export interface StockMovementRow {
    id: string;
    itemId: string;
    delta: number;
    reason: StockMovementReason;
    occurredAt: string;
    idempotencyKey: string | null;
    createdAt: string;
}

export interface StockLotAllocationRow {
    movementId: string;
    lotId: string;
    // 記録時点のロット期限のスナップショット。後の期限変更で履歴は変わらない
    expiryDate: string | null;
    delta: number;
}

export interface StockOperationRow {
    idempotencyKey: string;
    itemId: string;
    kind: StockOperationKind;
    delta: number;
    targetQuantity: number | null;
    reason: StockMovementReason;
    occurredAt: string;
    occurredAtProvided: boolean;
    movementId: string | null;
    resultingQuantity: number;
    createdAt: string;
    requestDigest: string | null;
}

/**
 * service が計画したロット変更 1 件。
 * `increase` と `set` は期限を conflict target にした upsert、`decrease` は
 * ロット id を指定した減算で適用する。
 * `set` は全数確定のため差分 0 の行も含み、その行は allocation を作らない。
 */
export type LotPlanEntry =
    | { operation: "increase"; expiryDate: string | null; delta: number }
    | {
          operation: "decrease";
          lotId: string;
          expiryDate: string | null;
          delta: number;
      }
    | {
          operation: "set";
          expiryDate: string | null;
          quantity: number;
          delta: number;
      };

/**
 * 再送判定に使うリクエストの同一性部分。ロット計画は現在の在庫状態から作るため、
 * 適用済みのリクエストを再送しただけで計画が作れなくなることがある。
 * 再送判定を計画より先に行えるよう、計画を含まない形を分けて持つ。
 */
export interface StockOperationIdentity {
    idempotencyKey: string;
    itemId: string;
    kind: StockOperationKind;
    // Adjustment callers provide a delta. Stocktake callers leave it null and
    // the transaction derives it from the resulting lot total.
    delta: number | null;
    targetQuantity: number | null;
    reason: StockMovementReason;
    occurredAt: string;
    occurredAtProvided: boolean;
    // 正規化リクエストの SHA-256 hex。再送のロット指定まで含めた同一性判定に使う
    requestDigest: string;
}

export interface StockOperationRequest extends StockOperationIdentity {
    lotPlan: readonly LotPlanEntry[];
    /**
     * 計画を作った時点のロット合計。棚卸しは全数確定であり、確定後の合計が
     * `targetQuantity` と一致することを保証しなければならないため、この値で
     * stale read を検出する。交換可能な加減算では pin しないので null。
     */
    expectedQuantity: number | null;
}

export interface StockWriteResult {
    // 記録された確定数量。ロットの現在値は書き込みとは別に読むため、応答の
    // 数量として使わない（記録値と現在のロット内訳を混ぜないため）
    resultingQuantity: number;
    movement: StockMovementRow | null;
    allocations: StockLotAllocationRow[];
    replayed: boolean;
}

export interface StockHistoryResult {
    movements: StockMovementRow[];
    allocationsByMovementId: Map<string, StockLotAllocationRow[]>;
    nextCursor: string | null;
}

export class InvalidStockCursorError extends Error {
    constructor() {
        super("invalid cursor");
        this.name = "InvalidStockCursorError";
    }
}

export class StockItemNotFoundError extends Error {
    constructor() {
        super("item was not found");
        this.name = "StockItemNotFoundError";
    }
}

export class StockNegativeQuantityError extends Error {
    constructor() {
        super("stock quantity cannot become negative");
        this.name = "StockNegativeQuantityError";
    }
}

export class StockOperationConflictError extends Error {
    constructor() {
        super("idempotency key was already used for a different operation");
        this.name = "StockOperationConflictError";
    }
}

export class StockLotConflictError extends Error {
    constructor() {
        super("stock was updated concurrently");
        this.name = "StockLotConflictError";
    }
}

type Cursor = {
    occurredAt: string;
    id: string;
    itemId: string | null;
    reason: StockMovementReason | null;
};

type StockOperationDbRow = Omit<StockOperationRow, "occurredAtProvided"> & {
    occurredAtProvided: number;
};

const isStockMovementReason = (value: unknown): value is StockMovementReason =>
    typeof value === "string" &&
    stockMovementReasons.some((reason) => reason === value);

const isCursorItemId = (value: unknown): value is string | null =>
    value === null || (typeof value === "string" && value.length > 0);

const isCursorReason = (value: unknown): value is StockMovementReason | null =>
    value === null || isStockMovementReason(value);

const encodeCursor = (cursor: Cursor): string =>
    btoa(encodeURIComponent(JSON.stringify(cursor)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");

const decodeCursor = (value: string): Cursor => {
    try {
        const unpadded = value.replaceAll("-", "+").replaceAll("_", "/");
        const padding = "=".repeat((4 - (unpadded.length % 4)) % 4);
        const parsed: unknown = JSON.parse(
            decodeURIComponent(atob(`${unpadded}${padding}`)),
        );
        if (typeof parsed !== "object" || parsed === null) {
            throw new Error("invalid cursor");
        }
        const candidate = parsed as {
            occurredAt?: unknown;
            id?: unknown;
            itemId?: unknown;
            reason?: unknown;
        };
        const occurredAt = stockOccurredAtSchema.safeParse(
            candidate.occurredAt,
        );
        if (
            !occurredAt.success ||
            typeof candidate.id !== "string" ||
            candidate.id.length === 0 ||
            !isCursorItemId(candidate.itemId) ||
            !isCursorReason(candidate.reason)
        ) {
            throw new Error("invalid cursor");
        }
        return {
            occurredAt: occurredAt.data,
            id: candidate.id,
            itemId: candidate.itemId,
            reason: candidate.reason,
        };
    } catch {
        throw new InvalidStockCursorError();
    }
};

const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

// 出庫のロット減算は ck_item_lots_quantity_non_negative で batch 全体が rollback される。
// これが stale read に対する最終防衛線であり、在庫不足として扱う
const isNegativeQuantityViolation = (error: unknown): boolean => {
    const message = errorMessage(error);
    return (
        message.includes("ck_item_lots_quantity_non_negative") ||
        message.includes("ck_items_current_quantity_non_negative") ||
        message.includes("ck_stock_operations_resulting_quantity_non_negative")
    );
};

// adjustment のロット合計差分が 0 になった場合と、棚卸しの全数確定の検証
// （stocktakeTargetExpression）が崩れた場合に発火する。どちらも同時更新で計画が
// 無意味になったことを意味するため、やり直せる競合として扱う
const isOperationPayloadViolation = (error: unknown): boolean =>
    errorMessage(error).includes("ck_stock_operations_payload");

// ロット upsert の FK 失敗は item が消えた場合だけ起こる
const isForeignKeyViolation = (error: unknown): boolean =>
    /\bforeign key constraint failed\b|\bSQLITE_CONSTRAINT_FOREIGNKEY\b/i.test(
        errorMessage(error),
    );

const getStockOperation = async (
    db: D1Database,
    idempotencyKey: string,
): Promise<StockOperationRow | null> => {
    const row = await db
        .prepare(
            `SELECT idempotency_key AS idempotencyKey,
                    item_id AS itemId,
                    kind,
                    delta,
                    target_quantity AS targetQuantity,
                    reason,
                    occurred_at AS occurredAt,
                    occurred_at_provided AS occurredAtProvided,
                    movement_id AS movementId,
                    resulting_quantity AS resultingQuantity,
                    created_at AS createdAt,
                    request_digest AS requestDigest
             FROM stock_operations
             WHERE idempotency_key = ?`,
        )
        .bind(idempotencyKey)
        .first<StockOperationDbRow>();
    if (!row) {
        return null;
    }
    return {
        ...row,
        occurredAtProvided: row.occurredAtProvided === 1,
    };
};

const getStockMovement = async (
    db: D1Database,
    id: string,
): Promise<StockMovementRow | null> =>
    db
        .prepare(
            `SELECT id,
                    item_id AS itemId,
                    delta,
                    reason,
                    occurred_at AS occurredAt,
                    idempotency_key AS idempotencyKey,
                    created_at AS createdAt
             FROM stock_movements
             WHERE id = ?`,
        )
        .bind(id)
        .first<StockMovementRow>();

/**
 * movement id をまとめて 1 クエリで引き、履歴一覧で N+1 を作らない。
 * ロット追跡導入前の movement には allocation が存在しないため、結果に現れない。
 */
export const listMovementAllocations = async (
    db: D1Database,
    movementIds: readonly string[],
): Promise<Map<string, StockLotAllocationRow[]>> => {
    const byMovementId = new Map<string, StockLotAllocationRow[]>();
    if (movementIds.length === 0) {
        return byMovementId;
    }
    const placeholders = movementIds.map(() => "?").join(", ");
    const result = await db
        .prepare(
            `SELECT a.movement_id AS movementId,
                    a.lot_id AS lotId,
                    a.expiry_date AS expiryDate,
                    a.delta
             FROM stock_movement_lot_allocations a
             WHERE a.movement_id IN (${placeholders})
             ORDER BY (a.expiry_date IS NULL) ASC, a.expiry_date ASC, a.lot_id ASC`,
        )
        .bind(...movementIds)
        .all<StockLotAllocationRow>();
    for (const row of result.results) {
        const rows = byMovementId.get(row.movementId);
        if (rows) {
            rows.push(row);
        } else {
            byMovementId.set(row.movementId, [row]);
        }
    }
    return byMovementId;
};

const getMovementAllocations = async (
    db: D1Database,
    movementId: string | null,
): Promise<StockLotAllocationRow[]> => {
    if (movementId === null) {
        return [];
    }
    const allocations = await listMovementAllocations(db, [movementId]);
    return allocations.get(movementId) ?? [];
};

export const itemExists = async (
    db: D1Database,
    itemId: string,
): Promise<boolean> =>
    Boolean(
        await db
            .prepare("SELECT id FROM items WHERE id = ? LIMIT 1")
            .bind(itemId)
            .first<{ id: string }>(),
    );

const isSameOperation = (
    existing: StockOperationRow,
    request: StockOperationIdentity,
): boolean => {
    // ロット指定まで含む再送は digest で比較する。0005 より前の行は digest を
    // 持たないため従来のフィールド比較へフォールバックする
    if (existing.requestDigest !== null) {
        return existing.requestDigest === request.requestDigest;
    }
    const occurredAtMatches =
        existing.occurredAtProvided && request.occurredAtProvided
            ? existing.occurredAt === request.occurredAt
            : !existing.occurredAtProvided && !request.occurredAtProvided;
    return (
        existing.itemId === request.itemId &&
        existing.kind === request.kind &&
        (request.kind === "stocktake"
            ? request.targetQuantity !== null &&
              existing.targetQuantity === request.targetQuantity
            : request.delta !== null && existing.delta === request.delta) &&
        existing.targetQuantity === request.targetQuantity &&
        existing.reason === request.reason &&
        occurredAtMatches
    );
};

const replayOperation = async (
    db: D1Database,
    existing: StockOperationRow,
    request: StockOperationIdentity,
): Promise<StockWriteResult> => {
    if (!isSameOperation(existing, request)) {
        throw new StockOperationConflictError();
    }
    const movement = existing.movementId
        ? await getStockMovement(db, existing.movementId)
        : null;
    if (existing.movementId && !movement) {
        throw new Error("stock operation movement could not be read");
    }
    return {
        resultingQuantity: existing.resultingQuantity,
        movement,
        allocations: await getMovementAllocations(db, existing.movementId),
        replayed: true,
    };
};

/**
 * 適用済みの idempotency key なら保存済みの結果を返す。未適用なら null。
 * 内訳が違うリクエストの再利用は `StockOperationConflictError` になる。
 */
export const replayStockOperation = async (
    db: D1Database,
    identity: StockOperationIdentity,
): Promise<StockWriteResult | null> => {
    const existing = await getStockOperation(db, identity.idempotencyKey);
    return existing ? replayOperation(db, existing, identity) : null;
};

const lotUpsertConflictTarget = (expiryDate: string | null): string =>
    // 部分 unique index を conflict target にできるのは期限なしロットだけである。
    // 期限付きロットに部分 index を指定すると conflict を検出できず
    // uq_item_lots_item_expiry の unique 違反になる
    expiryDate === null
        ? "ON CONFLICT(item_id) WHERE expiry_date IS NULL"
        : "ON CONFLICT(item_id, expiry_date)";

const createLotStatement = (
    db: D1Database,
    itemId: string,
    entry: LotPlanEntry,
    now: string,
): D1PreparedStatement => {
    if (entry.operation === "decrease") {
        return db
            .prepare(
                `UPDATE item_lots
                 SET quantity = quantity - ?, updated_at = ?
                 WHERE id = ? AND item_id = ?`,
            )
            .bind(-entry.delta, now, entry.lotId, itemId);
    }
    const assignment =
        entry.operation === "set"
            ? "quantity = excluded.quantity"
            : "quantity = quantity + excluded.quantity";
    const quantity = entry.operation === "set" ? entry.quantity : entry.delta;
    return db
        .prepare(
            `INSERT INTO item_lots
                (id, item_id, expiry_date, quantity, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ${lotUpsertConflictTarget(entry.expiryDate)} DO UPDATE SET
                ${assignment}, updated_at = excluded.updated_at`,
        )
        .bind(newId(), itemId, entry.expiryDate, quantity, now, now);
};

const lotTotal =
    "(SELECT COALESCE(SUM(quantity), 0) FROM item_lots WHERE item_id = items.id)";

// 棚卸しの全数確定を DB 側で検証する式。計画時のロット合計（items.current_quantity は
// この時点でまだ更新前）と確定後のロット合計の両方が期待どおりでなければ
// target_quantity を NULL にして ck_stock_operations_payload を踏ませ、
// バッチ全体を rollback させる。前者が崩れていると movement の delta と allocation の
// 合計が食い違い、後者が崩れていると宣言した数量と実際の在庫が食い違う
const stocktakeTargetExpression = `CASE WHEN current_quantity = ? AND ${lotTotal} = ?
                          THEN ? ELSE NULL END`;

const createOperationInsert = (
    db: D1Database,
    request: StockOperationRequest,
    movementId: string,
    createdAt: string,
): D1PreparedStatement => {
    if (request.kind === "adjustment") {
        if (request.delta === null || request.targetQuantity !== null) {
            throw new Error("invalid adjustment operation payload");
        }
    } else if (
        request.targetQuantity === null ||
        request.expectedQuantity === null
    ) {
        throw new Error("invalid stocktake operation payload");
    }
    const isStocktake = request.kind === "stocktake";
    // 数量が動くロット変更が 1 件もない棚卸しは no-op のため movement を作らない
    const producesMovement = request.lotPlan.some((entry) => entry.delta !== 0)
        ? 1
        : 0;
    // items.current_quantity はまだ更新前（= 変更前合計）なので、
    // delta と resulting_quantity を更新後のロット合計から導出できる
    return db
        .prepare(
            `INSERT INTO stock_operations
                (idempotency_key, item_id, kind, delta, target_quantity, reason,
                 occurred_at, occurred_at_provided, movement_id,
                 resulting_quantity, created_at, request_digest)
             SELECT ?, id, ?,
                    ${lotTotal} - current_quantity,
                    ${isStocktake ? stocktakeTargetExpression : "?"}, ?, ?, ?,
                    CASE WHEN ? = 1 THEN ? ELSE NULL END,
                    ${lotTotal},
                    ?, ?
             FROM items
             WHERE id = ?`,
        )
        .bind(
            request.idempotencyKey,
            request.kind,
            ...(isStocktake
                ? [
                      request.expectedQuantity,
                      request.targetQuantity,
                      request.targetQuantity,
                  ]
                : [request.targetQuantity]),
            request.reason,
            request.occurredAt,
            request.occurredAtProvided ? 1 : 0,
            producesMovement,
            movementId,
            createdAt,
            request.requestDigest,
            request.itemId,
        );
};

const createAllocationInsert = (
    db: D1Database,
    request: StockOperationRequest,
    entry: LotPlanEntry,
    createdAt: string,
): D1PreparedStatement =>
    // 減算は計画がロット id を持つので id で解決する。加算・棚卸しは upsert が既存行に
    // 当たった場合にロット id が未知なので期限で JOIN する（(item_id, expiry_date) は
    // unique、期限なしは部分 unique index があるため 1 行に定まる）。
    // 期限は解決したロット行から写して記録時点のスナップショットにする
    db
        .prepare(
            `INSERT INTO stock_movement_lot_allocations
                (id, movement_id, lot_id, expiry_date, delta, created_at)
             SELECT ?, o.movement_id, l.id, l.expiry_date, ?, ?
             FROM stock_operations o
             JOIN item_lots l ON l.item_id = o.item_id AND ${
                 entry.operation === "decrease"
                     ? "l.id = ?"
                     : "l.expiry_date IS ?"
             }
             WHERE o.idempotency_key = ? AND o.movement_id IS NOT NULL`,
        )
        .bind(
            newId(),
            entry.delta,
            createdAt,
            entry.operation === "decrease" ? entry.lotId : entry.expiryDate,
            request.idempotencyKey,
        );

export const appendStockOperation = async (
    db: D1Database,
    request: StockOperationRequest,
): Promise<StockWriteResult> => {
    const existing = await getStockOperation(db, request.idempotencyKey);
    if (existing) {
        return replayOperation(db, existing, request);
    }

    const createdAt = new Date().toISOString();
    const movementId = newId();
    const lotStatements = request.lotPlan.map((entry) =>
        createLotStatement(db, request.itemId, entry, createdAt),
    );
    const operationInsert = createOperationInsert(
        db,
        request,
        movementId,
        createdAt,
    );
    // ロットが在庫の正なので、items.current_quantity はロット合計から再計算する
    const updateItem = db
        .prepare(
            `UPDATE items
             SET current_quantity = (
                     SELECT COALESCE(SUM(quantity), 0)
                     FROM item_lots
                     WHERE item_id = items.id
                 ),
                 updated_at = ?
             WHERE id = ?
               AND EXISTS (
                     SELECT 1
                     FROM stock_operations
                     WHERE idempotency_key = ?
                 )`,
        )
        .bind(createdAt, request.itemId, request.idempotencyKey);
    const insertMovement = db
        .prepare(
            `INSERT INTO stock_movements
                (id, item_id, delta, reason, purchase_id, occurred_at,
                 idempotency_key, created_at)
             SELECT movement_id, item_id, delta, reason, NULL, occurred_at,
                    idempotency_key, created_at
             FROM stock_operations
             WHERE idempotency_key = ?
               AND movement_id IS NOT NULL`,
        )
        .bind(request.idempotencyKey);
    // 差分 0 の計画（全数確定のために絶対値を書き込むだけの行）は allocation を作らない
    const allocationInserts = request.lotPlan
        .filter((entry) => entry.delta !== 0)
        .map((entry) => createAllocationInsert(db, request, entry, createdAt));

    try {
        // D1 の batch は 1 トランザクションで、いずれかが失敗すれば全体が rollback される
        const results = await db.batch([
            ...lotStatements,
            operationInsert,
            updateItem,
            insertMovement,
            ...allocationInserts,
        ]);
        const operationChanges =
            results[lotStatements.length]?.meta.changes ?? 0;
        if (operationChanges === 0) {
            throw new StockItemNotFoundError();
        }
    } catch (error) {
        // 同一 idempotency key の同時再送では、ロットの statement が operation の
        // INSERT より前に並ぶため重複キーより先に在庫の CHECK が発火する。
        // どの失敗でも先に適用済みの操作を確認し、適用済みなら replay として返す
        const raced = await getStockOperation(db, request.idempotencyKey);
        if (raced) {
            return replayOperation(db, raced, request);
        }
        if (isNegativeQuantityViolation(error)) {
            throw new StockNegativeQuantityError();
        }
        if (isOperationPayloadViolation(error)) {
            throw new StockLotConflictError();
        }
        if (isForeignKeyViolation(error)) {
            throw new StockItemNotFoundError();
        }
        throw error;
    }

    const operation = await getStockOperation(db, request.idempotencyKey);
    if (!operation) {
        throw new Error("stock operation could not be read after insert");
    }
    const movement = operation.movementId
        ? await getStockMovement(db, operation.movementId)
        : null;
    if (operation.movementId && !movement) {
        throw new Error("stock operation movement could not be read");
    }
    return {
        resultingQuantity: operation.resultingQuantity,
        movement,
        allocations: await getMovementAllocations(db, operation.movementId),
        replayed: false,
    };
};

export const listStockMovements = async (
    db: D1Database,
    query: StockHistoryQuery,
): Promise<StockHistoryResult> => {
    const where: string[] = [];
    const bindings: unknown[] = [];
    if (query.itemId) {
        where.push("item_id = ?");
        bindings.push(query.itemId);
    }
    if (query.reason) {
        where.push("reason = ?");
        bindings.push(query.reason);
    }
    if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        const itemScope = query.itemId ?? null;
        const reasonScope = query.reason ?? null;
        if (cursor.itemId !== itemScope || cursor.reason !== reasonScope) {
            throw new InvalidStockCursorError();
        }
        where.push("(occurred_at < ? OR (occurred_at = ? AND id < ?))");
        bindings.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
    }
    const result = await db
        .prepare(
            `SELECT id,
                    item_id AS itemId,
                    delta,
                    reason,
                    occurred_at AS occurredAt,
                    idempotency_key AS idempotencyKey,
                    created_at AS createdAt
             FROM stock_movements
             ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY occurred_at DESC, id DESC
             LIMIT ?`,
        )
        .bind(...bindings, query.limit + 1)
        .all<StockMovementRow>();
    const rows = result.results;
    const hasMore = rows.length > query.limit;
    const movements = hasMore ? rows.slice(0, query.limit) : rows;
    const last = movements.at(-1);
    return {
        movements,
        allocationsByMovementId: await listMovementAllocations(
            db,
            movements.map((movement) => movement.id),
        ),
        nextCursor:
            hasMore && last
                ? encodeCursor({
                      occurredAt: last.occurredAt,
                      id: last.id,
                      itemId: query.itemId ?? null,
                      reason: query.reason ?? null,
                  })
                : null,
    };
};
