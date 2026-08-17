import {
    type ItemLotDto,
    type ItemLotListDto,
    lotListQuerySchema,
    lotUpdateSchema,
} from "../domain/lot";
import { getItem as getItemRecord } from "../repositories/itemRepository";
import {
    getItemLot,
    type ItemLotRow,
    LotExpiryConflictError,
    listItemLots as listItemLotRecords,
    updateLotExpiryDate as updateLotExpiryDateRecord,
} from "../repositories/lotRepository";

export class LotServiceError extends Error {
    readonly status: 400 | 404 | 409;
    readonly code: string;

    constructor(status: 400 | 404 | 409, code: string, message: string) {
        super(message);
        this.name = "LotServiceError";
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
        throw new LotServiceError(
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

const normalizeId = (value: string, label: string): string => {
    const normalized = value.trim();
    if (normalized.length === 0) {
        throw new LotServiceError(
            400,
            "INVALID_ID",
            `${label} must not be empty`,
        );
    }
    return normalized;
};

const requireItem = async (db: D1Database, itemId: string): Promise<void> => {
    if (!(await getItemRecord(db, itemId))) {
        throw new LotServiceError(404, "ITEM_NOT_FOUND", "item was not found");
    }
};

export const listItemLots = async (
    db: D1Database,
    itemId: string,
    input: unknown,
): Promise<ItemLotListDto> => {
    const normalizedItemId = normalizeId(itemId, "item id");
    const query = parseOrThrow(lotListQuerySchema.safeParse(input));
    await requireItem(db, normalizedItemId);
    const lots = await listItemLotRecords(db, normalizedItemId, {
        includeEmpty: query.includeEmpty,
    });
    return { lots: lots.map(toLotDto) };
};

/**
 * ロットの期限を変更する。変更先と同じ期限のロットが既にある場合は数量を合算し、
 * 移動元は数量 0 のロットとして残す。合計数量は変わらないため movement は記録しない。
 * 過去の movement の内訳は記録時点の期限を保持しているため、期限変更でも履歴は変わらない。
 */
export const updateLotExpiryDate = async (
    db: D1Database,
    itemId: string,
    lotId: string,
    input: unknown,
): Promise<ItemLotListDto> => {
    const normalizedItemId = normalizeId(itemId, "item id");
    const normalizedLotId = normalizeId(lotId, "lot id");
    const parsed = parseOrThrow(lotUpdateSchema.safeParse(input));
    await requireItem(db, normalizedItemId);
    const lot = await getItemLot(db, normalizedItemId, normalizedLotId);
    if (!lot) {
        throw new LotServiceError(404, "LOT_NOT_FOUND", "lot was not found");
    }
    if (lot.expiryDate !== parsed.expiryDate) {
        try {
            await updateLotExpiryDateRecord(
                db,
                normalizedItemId,
                lot,
                parsed.expiryDate,
            );
        } catch (error) {
            if (error instanceof LotExpiryConflictError) {
                throw new LotServiceError(
                    409,
                    "STOCK_LOT_CONFLICT",
                    "在庫が同時に更新されました。やり直してください。",
                );
            }
            throw error;
        }
    }
    const lots = await listItemLotRecords(db, normalizedItemId, {
        includeEmpty: false,
    });
    return { lots: lots.map(toLotDto) };
};
