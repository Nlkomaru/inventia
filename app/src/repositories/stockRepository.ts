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
}

export interface StockOperationRequest {
    idempotencyKey: string;
    itemId: string;
    kind: StockOperationKind;
    // Adjustment callers provide a delta. Stocktake callers leave it null and
    // the transaction derives it from the current item quantity.
    delta: number | null;
    targetQuantity: number | null;
    reason: StockMovementReason;
    occurredAt: string;
    occurredAtProvided: boolean;
}

export interface StockWriteResult {
    currentQuantity: number;
    movement: StockMovementRow | null;
    replayed: boolean;
}

export interface StockHistoryResult {
    movements: StockMovementRow[];
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

const isUniqueViolation = (error: unknown): boolean =>
    errorMessage(error).toLowerCase().includes("unique constraint failed");

const isNegativeQuantityViolation = (error: unknown): boolean =>
    errorMessage(error).includes(
        "ck_stock_operations_resulting_quantity_non_negative",
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
                    created_at AS createdAt
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
    request: StockOperationRequest,
): boolean => {
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
    request: StockOperationRequest,
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
        currentQuantity: existing.resultingQuantity,
        movement,
        replayed: true,
    };
};

const createOperationInsert = (
    db: D1Database,
    request: StockOperationRequest,
    movementId: string | null,
    createdAt: string,
): D1PreparedStatement => {
    const occurredAtProvided = request.occurredAtProvided ? 1 : 0;
    if (request.kind === "adjustment") {
        if (request.delta === null || request.targetQuantity !== null) {
            throw new Error("invalid adjustment operation payload");
        }
        return db
            .prepare(
                `INSERT INTO stock_operations
                    (idempotency_key, item_id, kind, delta, target_quantity,
                     reason, occurred_at, occurred_at_provided, movement_id,
                     resulting_quantity, created_at)
                 SELECT ?, ?, 'adjustment', ?, NULL, ?, ?, ?, ?,
                        current_quantity + ?, ?
                 FROM items
                 WHERE id = ?`,
            )
            .bind(
                request.idempotencyKey,
                request.itemId,
                request.delta,
                request.reason,
                request.occurredAt,
                occurredAtProvided,
                movementId,
                request.delta,
                createdAt,
                request.itemId,
            );
    }
    return db
        .prepare(
            `INSERT INTO stock_operations
                (idempotency_key, item_id, kind, delta, target_quantity,
                 reason, occurred_at, occurred_at_provided, movement_id,
                 resulting_quantity, created_at)
             SELECT ?, ?, 'stocktake', ? - current_quantity, ?, ?, ?, ?,
                    CASE WHEN current_quantity = ? THEN NULL ELSE ? END,
                    ?, ?
             FROM items
             WHERE id = ?`,
        )
        .bind(
            request.idempotencyKey,
            request.itemId,
            request.targetQuantity,
            request.targetQuantity,
            request.reason,
            request.occurredAt,
            occurredAtProvided,
            request.targetQuantity,
            movementId,
            request.targetQuantity,
            createdAt,
            request.itemId,
        );
};

export const appendStockOperation = async (
    db: D1Database,
    request: StockOperationRequest,
): Promise<StockWriteResult> => {
    const existing = await getStockOperation(db, request.idempotencyKey);
    if (existing) {
        return replayOperation(db, existing, request);
    }

    const createdAt = new Date().toISOString();
    // Stocktake decides whether it is a no-op inside the INSERT ... SELECT,
    // after reading the same current quantity that determines its delta.
    const movementId = newId();
    const operationInsert = createOperationInsert(
        db,
        request,
        movementId,
        createdAt,
    );
    const updateItem = db
        .prepare(
            `UPDATE items
             SET current_quantity = (
                     SELECT resulting_quantity
                     FROM stock_operations
                     WHERE idempotency_key = ?
                 ),
                 updated_at = ?
             WHERE id = ?
               AND EXISTS (
                     SELECT 1
                     FROM stock_operations
                     WHERE idempotency_key = ?
                 )`,
        )
        .bind(
            request.idempotencyKey,
            createdAt,
            request.itemId,
            request.idempotencyKey,
        );
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

    try {
        const results = await db.batch([
            operationInsert,
            updateItem,
            insertMovement,
        ]);
        const operationChanges = results[0]?.meta.changes ?? 0;
        if (operationChanges === 0) {
            throw new StockItemNotFoundError();
        }
    } catch (error) {
        if (isNegativeQuantityViolation(error)) {
            throw new StockNegativeQuantityError();
        }
        if (isUniqueViolation(error)) {
            const raced = await getStockOperation(db, request.idempotencyKey);
            if (raced) {
                return replayOperation(db, raced, request);
            }
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
        currentQuantity: operation.resultingQuantity,
        movement,
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
