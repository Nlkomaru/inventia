import {
    allocateFefo,
    findDuplicateExpiryDate,
    type ItemLotDto,
    type LotAllocationDto,
    type LotStocktakeEntry,
    planStocktakeLots,
    resolveTotalStocktakeTarget,
} from "../domain/lot";
import {
    type StockAdjustmentInput,
    type StockHistoryQuery,
    type StockLotSelector,
    type StockMovementDto,
    type StockOperationResult,
    type StocktakeInput,
    stockAdjustmentSchema,
    stockHistoryQuerySchema,
    stockRequestDigest,
    stocktakeSchema,
} from "../domain/stock";
import { type ItemLotRow, listItemLots } from "../repositories/lotRepository";
import {
    appendStockOperation,
    InvalidStockCursorError,
    itemExists,
    type LotPlanEntry,
    listStockMovements,
    type StockHistoryResult as RepositoryHistoryResult,
    replayStockOperation,
    StockItemNotFoundError,
    type StockLotAllocationRow,
    StockLotConflictError,
    type StockMovementRow,
    StockNegativeQuantityError,
    StockOperationConflictError,
    type StockOperationIdentity,
    type StockWriteResult,
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

const toLotDto = (row: ItemLotRow): ItemLotDto => ({
    id: row.id,
    itemId: row.itemId,
    expiryDate: row.expiryDate,
    quantity: row.quantity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const toAllocationDto = (row: StockLotAllocationRow): LotAllocationDto => ({
    lotId: row.lotId,
    expiryDate: row.expiryDate,
    delta: row.delta,
});

const toMovementDto = (
    row: StockMovementRow,
    allocations: readonly StockLotAllocationRow[],
): StockMovementDto => ({
    id: row.id,
    itemId: row.itemId,
    delta: row.delta,
    reason: row.reason,
    occurredAt: row.occurredAt,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    allocations: allocations.map(toAllocationDto),
});

// ロットが在庫の正なので、応答の数量とロット内訳は同じ読み取りから導く。
// 記録済みの resulting_quantity と混ぜると、再送応答や同時更新のあとで
// currentQuantity == sum(lots.quantity) が崩れる
const toOperationResult = async (
    db: D1Database,
    itemId: string,
    result: StockWriteResult,
): Promise<StockOperationResult> => {
    const lots = await listItemLots(db, itemId, { includeEmpty: false });
    return {
        itemId,
        currentQuantity: lots.reduce((total, lot) => total + lot.quantity, 0),
        movement: result.movement
            ? toMovementDto(result.movement, result.allocations)
            : null,
        allocations: result.allocations.map(toAllocationDto),
        lots: lots.map(toLotDto),
        replayed: result.replayed,
    };
};

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
    if (error instanceof StockLotConflictError) {
        throw new StockServiceError(
            409,
            "STOCK_LOT_CONFLICT",
            "在庫が同時に更新されました。やり直してください。",
        );
    }
    if (error instanceof InvalidStockCursorError) {
        throw new StockServiceError(400, "INVALID_CURSOR", error.message);
    }
    throw error;
};

const lotNotFound = (): never => {
    throw new StockServiceError(
        404,
        "LOT_NOT_FOUND",
        "指定した期限のロットが見つかりません。ロット一覧から対象を選び直してください。",
    );
};

const insufficientStock = (): never => {
    throw new StockServiceError(
        409,
        "INSUFFICIENT_STOCK",
        "出庫量が対象ロットの在庫を超えています。",
    );
};

const toLotSelector = (input: StockAdjustmentInput): StockLotSelector => {
    if (input.lotId !== undefined) {
        return { mode: "lot", lotId: input.lotId };
    }
    if (input.expiryDate !== undefined) {
        return { mode: "expiry", expiryDate: input.expiryDate };
    }
    return { mode: "unspecified" };
};

const findLotById = (
    lots: readonly ItemLotRow[],
    lotId: string,
): ItemLotRow => {
    const lot = lots.find((candidate) => candidate.id === lotId);
    if (!lot) {
        return lotNotFound();
    }
    return lot;
};

const findLotByExpiry = (
    lots: readonly ItemLotRow[],
    expiryDate: string | null,
): ItemLotRow => {
    const lot = lots.find((candidate) => candidate.expiryDate === expiryDate);
    if (!lot) {
        return lotNotFound();
    }
    return lot;
};

// 入庫は期限を conflict target にした upsert で加算し、出庫は対象ロットから減算する。
// 出庫でロット指定がない場合だけ FEFO で自動配分する
const planAdjustment = (
    lots: readonly ItemLotRow[],
    delta: number,
    selector: StockLotSelector,
): LotPlanEntry[] => {
    if (delta > 0) {
        const expiryDate =
            selector.mode === "lot"
                ? findLotById(lots, selector.lotId).expiryDate
                : selector.mode === "expiry"
                  ? selector.expiryDate
                  : null;
        return [{ operation: "increase", expiryDate, delta }];
    }
    const requested = -delta;
    if (selector.mode === "unspecified") {
        const allocation = allocateFefo(lots, requested);
        if (allocation.shortage > 0) {
            return insufficientStock();
        }
        return allocation.allocations.map(
            (entry): LotPlanEntry => ({
                operation: "decrease",
                lotId: entry.lotId,
                expiryDate: entry.expiryDate,
                delta: entry.delta,
            }),
        );
    }
    // 数量 0 のロットは行として残るため、指定されたロットが存在しても在庫不足になり得る
    const lot =
        selector.mode === "lot"
            ? findLotById(lots, selector.lotId)
            : findLotByExpiry(lots, selector.expiryDate);
    if (lot.quantity < requested) {
        return insufficientStock();
    }
    return [
        {
            operation: "decrease",
            lotId: lot.id,
            expiryDate: lot.expiryDate,
            delta,
        },
    ];
};

const requireItem = async (db: D1Database, itemId: string): Promise<void> => {
    if (!(await itemExists(db, itemId))) {
        throw new StockItemNotFoundError();
    }
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
    const selector = toLotSelector(parsed);
    try {
        const identity: StockOperationIdentity = {
            idempotencyKey: parsed.idempotencyKey,
            itemId: normalizedItemId,
            kind: "adjustment",
            delta: parsed.delta,
            targetQuantity: null,
            reason: parsed.reason,
            occurredAt: occurredAt.occurredAt,
            occurredAtProvided: occurredAt.occurredAtProvided,
            requestDigest: await stockRequestDigest({
                kind: "adjustment",
                itemId: normalizedItemId,
                reason: parsed.reason,
                occurredAt: occurredAt.occurredAtProvided
                    ? occurredAt.occurredAt
                    : null,
                delta: parsed.delta,
                targetQuantity: null,
                selector,
                lots: null,
            }),
        };
        // 適用済みのリクエストはロット計画を作らずに保存済みの結果を返す。
        // 適用後の在庫では同じ計画を作れないため、再送判定を計画より先に行う
        const replayed = await replayStockOperation(db, identity);
        if (replayed) {
            return await toOperationResult(db, normalizedItemId, replayed);
        }
        await requireItem(db, normalizedItemId);
        // 数量 0 のロットも upsert 先・指定先になり得るため全件読む
        const lots = await listItemLots(db, normalizedItemId, {
            includeEmpty: true,
        });
        const lotPlan = planAdjustment(lots, parsed.delta, selector);
        // 加減算は交換可能なので、同時に別の加減算が入っても計画は有効である
        const result = await appendStockOperation(db, {
            ...identity,
            lotPlan,
            expectedQuantity: null,
        });
        return await toOperationResult(db, normalizedItemId, result);
    } catch (error) {
        return mapRepositoryError(error);
    }
};

// 棚卸しは全数確定のため、リクエストに現れない既存ロットは 0 になる。
// 確定後の合計は指定数量の合計そのものであり、現在の在庫状態に依存しない
const stocktakeTargetQuantity = (parsed: StocktakeInput): number => {
    if (parsed.lots !== undefined) {
        if (findDuplicateExpiryDate(parsed.lots)) {
            throw new StockServiceError(
                400,
                "LOT_DUPLICATE_EXPIRY",
                "同じ期限のロットを複数指定できません。期限ごとに 1 行へまとめてください。",
            );
        }
        return parsed.lots.reduce((total, lot) => total + lot.quantity, 0);
    }
    if (parsed.quantity !== undefined) {
        return parsed.quantity;
    }
    throw new StockServiceError(
        400,
        "VALIDATION_ERROR",
        "quantity: exactly one of quantity or lots is required",
    );
};

// 合計指定はどのロットへ適用するかを現在の在庫状態から決める。
// `totalQuantity` は stocktakeTargetQuantity で検証済みの合計である
const resolveStocktakeLots = (
    parsed: StocktakeInput,
    lots: readonly ItemLotRow[],
    totalQuantity: number,
): LotStocktakeEntry[] => {
    if (parsed.lots !== undefined) {
        return [...parsed.lots];
    }
    const target = resolveTotalStocktakeTarget(lots);
    if (!target.resolved) {
        throw new StockServiceError(
            400,
            "STOCKTAKE_TOTAL_AMBIGUOUS",
            "在庫のあるロットが複数あるため合計値では確定できません。lots で期限ごとの数量を指定してください。",
        );
    }
    return [{ expiryDate: target.expiryDate, quantity: totalQuantity }];
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
        const targetQuantity = stocktakeTargetQuantity(parsed);
        const identity: StockOperationIdentity = {
            idempotencyKey: parsed.idempotencyKey,
            itemId: normalizedItemId,
            kind: "stocktake",
            // The repository derives this from the resulting lot total.
            delta: null,
            targetQuantity,
            reason: "stocktake",
            occurredAt: occurredAt.occurredAt,
            occurredAtProvided: occurredAt.occurredAtProvided,
            requestDigest: await stockRequestDigest({
                kind: "stocktake",
                itemId: normalizedItemId,
                reason: "stocktake",
                occurredAt: occurredAt.occurredAtProvided
                    ? occurredAt.occurredAt
                    : null,
                delta: null,
                targetQuantity,
                selector: { mode: "unspecified" },
                // 合計指定の対象ロットは現在の在庫状態から導くため digest には含めない。
                // 適用後は状態が変わり、同じリクエストでも導出結果が変わり得る
                lots: parsed.lots ?? null,
            }),
        };
        const replayed = await replayStockOperation(db, identity);
        if (replayed) {
            return await toOperationResult(db, normalizedItemId, replayed);
        }
        await requireItem(db, normalizedItemId);
        const lots = await listItemLots(db, normalizedItemId, {
            includeEmpty: true,
        });
        const lotPlan = planStocktakeLots(
            lots,
            resolveStocktakeLots(parsed, lots, targetQuantity),
        ).map(
            (entry): LotPlanEntry => ({
                operation: "set",
                expiryDate: entry.expiryDate,
                quantity: entry.quantity,
                delta: entry.delta,
            }),
        );
        // 計画は絶対値指定なので、読み取り後に在庫が動くと全数確定が成立しない。
        // 読み取った合計を渡し、確定時に一致しなければ競合として扱う
        const result = await appendStockOperation(db, {
            ...identity,
            lotPlan,
            expectedQuantity: lots.reduce(
                (total, lot) => total + lot.quantity,
                0,
            ),
        });
        return await toOperationResult(db, normalizedItemId, result);
    } catch (error) {
        return mapRepositoryError(error);
    }
};

const toHistoryResult = (
    result: RepositoryHistoryResult,
): { movements: StockMovementDto[]; nextCursor: string | null } => ({
    movements: result.movements.map((movement) =>
        toMovementDto(
            movement,
            result.allocationsByMovementId.get(movement.id) ?? [],
        ),
    ),
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
