import {
    type StockAdjustmentInput,
    type StockHistoryQuery,
    type StockMovementDto,
    type StockOperationResult,
    type StocktakeInput,
    stockAdjustmentSchema,
    stockHistoryQuerySchema,
    stocktakeSchema,
} from "../domain/stock";
import {
    appendStockOperation,
    InvalidStockCursorError,
    itemExists,
    listStockMovements,
    type StockHistoryResult as RepositoryHistoryResult,
    StockItemNotFoundError,
    type StockMovementRow,
    StockNegativeQuantityError,
    StockOperationConflictError,
} from "../repositories/stockRepository";

export class StockServiceError extends Error {
    readonly status: 400 | 404 | 409;
    readonly code: string;

    constructor(status: 400 | 404 | 409, code: string, message: string) {
        super(message);
        this.name = "StockServiceError";
        this.status = status;
        this.code = code;
    }
}

const validationMessage = (
    issues: { message: string; path: PropertyKey[] }[],
): string =>
    issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join(", ");

const parseOrThrow = <T>(
    result:
        | { success: true; data: T }
        | {
              success: false;
              error: { issues: { message: string; path: PropertyKey[] }[] };
          },
): T => {
    if (!result.success) {
        throw new StockServiceError(
            400,
            "VALIDATION_ERROR",
            validationMessage(result.error.issues),
        );
    }
    return result.data;
};

const toMovementDto = (row: StockMovementRow): StockMovementDto => ({
    id: row.id,
    itemId: row.itemId,
    delta: row.delta,
    reason: row.reason,
    occurredAt: row.occurredAt,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
});

const toOperationResult = (
    result: {
        currentQuantity: number;
        movement: StockMovementRow | null;
        replayed: boolean;
    },
    itemId: string,
): StockOperationResult => ({
    itemId,
    currentQuantity: result.currentQuantity,
    movement: result.movement ? toMovementDto(result.movement) : null,
    replayed: result.replayed,
});

const defaultOccurredAt = (): string => new Date().toISOString();

const normalizeOccurredAt = (
    occurredAt: string | undefined,
): { occurredAt: string; occurredAtProvided: boolean } => {
    if (occurredAt === undefined) {
        return { occurredAt: defaultOccurredAt(), occurredAtProvided: false };
    }
    const timestamp = Date.parse(occurredAt);
    if (!Number.isFinite(timestamp)) {
        throw new StockServiceError(
            400,
            "INVALID_OCCURRED_AT",
            "occurredAt must be a valid UTC date-time",
        );
    }
    return {
        occurredAt: new Date(timestamp).toISOString(),
        occurredAtProvided: true,
    };
};

const normalizeItemId = (itemId: string): string => {
    const normalized = itemId.trim();
    if (normalized.length === 0) {
        throw new StockServiceError(
            400,
            "INVALID_ID",
            "item id must not be empty",
        );
    }
    return normalized;
};

const mapRepositoryError = (error: unknown): never => {
    if (error instanceof StockItemNotFoundError) {
        throw new StockServiceError(404, "ITEM_NOT_FOUND", error.message);
    }
    if (error instanceof StockNegativeQuantityError) {
        throw new StockServiceError(409, "INSUFFICIENT_STOCK", error.message);
    }
    if (error instanceof StockOperationConflictError) {
        throw new StockServiceError(409, "IDEMPOTENCY_CONFLICT", error.message);
    }
    if (error instanceof InvalidStockCursorError) {
        throw new StockServiceError(400, "INVALID_CURSOR", error.message);
    }
    throw error;
};

export const adjustStock = async (
    db: D1Database,
    itemId: string,
    input: unknown,
): Promise<StockOperationResult> => {
    const normalizedItemId = normalizeItemId(itemId);
    const parsed: StockAdjustmentInput = parseOrThrow(
        stockAdjustmentSchema.safeParse(input),
    );
    const occurredAt = normalizeOccurredAt(parsed.occurredAt);
    try {
        const result = await appendStockOperation(db, {
            idempotencyKey: parsed.idempotencyKey,
            itemId: normalizedItemId,
            kind: "adjustment",
            delta: parsed.delta,
            targetQuantity: null,
            reason: parsed.reason,
            occurredAt: occurredAt.occurredAt,
            occurredAtProvided: occurredAt.occurredAtProvided,
        });
        return toOperationResult(result, normalizedItemId);
    } catch (error) {
        return mapRepositoryError(error);
    }
};

export const stocktake = async (
    db: D1Database,
    itemId: string,
    input: unknown,
): Promise<StockOperationResult> => {
    const normalizedItemId = normalizeItemId(itemId);
    const parsed: StocktakeInput = parseOrThrow(
        stocktakeSchema.safeParse(input),
    );
    const occurredAt = normalizeOccurredAt(parsed.occurredAt);
    try {
        const result = await appendStockOperation(db, {
            idempotencyKey: parsed.idempotencyKey,
            itemId: normalizedItemId,
            kind: "stocktake",
            // The repository derives this from the transaction's current value.
            delta: null,
            targetQuantity: parsed.quantity,
            reason: "stocktake",
            occurredAt: occurredAt.occurredAt,
            occurredAtProvided: occurredAt.occurredAtProvided,
        });
        return toOperationResult(result, normalizedItemId);
    } catch (error) {
        return mapRepositoryError(error);
    }
};

const toHistoryResult = (
    result: RepositoryHistoryResult,
): { movements: StockMovementDto[]; nextCursor: string | null } => ({
    movements: result.movements.map(toMovementDto),
    nextCursor: result.nextCursor,
});

export const listStockHistory = async (
    db: D1Database,
    input: unknown,
): Promise<{ movements: StockMovementDto[]; nextCursor: string | null }> => {
    const parsed: StockHistoryQuery = parseOrThrow(
        stockHistoryQuerySchema.safeParse(input),
    );
    try {
        if (parsed.itemId && !(await itemExists(db, parsed.itemId))) {
            throw new StockItemNotFoundError();
        }
        return toHistoryResult(await listStockMovements(db, parsed));
    } catch (error) {
        return mapRepositoryError(error);
    }
};
