import {
    type ItemCreateInput,
    type ItemDetailDto,
    type ItemDto,
    type ItemListQuery,
    type ItemUpdateInput,
    itemCreateSchema,
    itemListQuerySchema,
    itemUpdateSchema,
} from "../domain/item";
import {
    earliestExpiryDate,
    type ItemLotDto,
    lotExpiryDateSchema,
} from "../domain/lot";
import {
    categoryExists,
    createItem as createItemRecord,
    deleteItem as deleteItemRecord,
    getCategoryKind,
    getItem as getItemRecord,
    InvalidItemCursorError,
    type ItemRow,
    listItems as listItemRecords,
    locationExists,
    updateItem as updateItemRecord,
} from "../repositories/itemRepository";
import { type ItemLotRow, listItemLots } from "../repositories/lotRepository";

export class ItemServiceError extends Error {
    readonly status: 400 | 404 | 409;
    readonly code: string;

    constructor(status: 400 | 404 | 409, code: string, message: string) {
        super(message);
        this.name = "ItemServiceError";
        this.status = status;
        this.code = code;
    }
}

const validationMessage = (
    issues: { message: string; path: PropertyKey[] }[],
) =>
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
        throw new ItemServiceError(
            400,
            "VALIDATION_ERROR",
            validationMessage(result.error.issues),
        );
    }
    return result.data;
};

const isItemDeleteForeignKeyConflict = (error: unknown): boolean =>
    /\bforeign key constraint failed\b|\bSQLITE_CONSTRAINT_FOREIGNKEY\b/i.test(
        error instanceof Error ? error.message : String(error),
    );

const isDocumentCategory = (
    kind: Awaited<ReturnType<typeof getCategoryKind>>,
): boolean => kind === "document";

const toDto = (row: ItemRow): ItemDto => ({
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    locationId: row.locationId,
    baseUnit: row.baseUnit,
    baseDimension: row.baseDimension,
    currentQuantity: row.currentQuantity,
    earliestExpiryDate: lotExpiryDateSchema.parse(row.earliestExpiryDate),
    lotCount: row.lotCount,
    lowStockThreshold: row.lowStockThreshold,
    memo: row.memo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const toLotDto = (row: ItemLotRow): ItemLotDto => ({
    id: row.id,
    itemId: row.itemId,
    expiryDate: row.expiryDate,
    quantity: row.quantity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

// 詳細では同梱したロットから期限集計を導き、内訳と要約が食い違わないようにする
const toDetailDto = (row: ItemRow, lots: ItemLotRow[]): ItemDetailDto => ({
    ...toDto(row),
    earliestExpiryDate: earliestExpiryDate(lots),
    lotCount: lots.length,
    lots: lots.map(toLotDto),
});

export const listItems = async (
    db: D1Database,
    input: unknown,
): Promise<{ items: ItemDto[]; nextCursor: string | null }> => {
    const query = parseOrThrow(itemListQuerySchema.safeParse(input));
    try {
        const result = await listItemRecords(db, query);
        return {
            items: result.items.map(toDto),
            nextCursor: result.nextCursor,
        };
    } catch (error) {
        if (error instanceof InvalidItemCursorError) {
            throw new ItemServiceError(
                400,
                "INVALID_CURSOR",
                "cursor is invalid",
            );
        }
        throw error;
    }
};

export const getItem = async (
    db: D1Database,
    id: string,
): Promise<ItemDetailDto> => {
    if (id.trim().length === 0) {
        throw new ItemServiceError(400, "INVALID_ID", "id must not be empty");
    }
    const row = await getItemRecord(db, id);
    if (!row) {
        throw new ItemServiceError(404, "ITEM_NOT_FOUND", "item was not found");
    }
    // 数量 0 のロットは既定の表示対象外のため詳細にも含めない
    const lots = await listItemLots(db, id, { includeEmpty: false });
    return toDetailDto(row, lots);
};

export const createItem = async (
    db: D1Database,
    input: unknown,
): Promise<ItemDto> => {
    const parsed = parseOrThrow(itemCreateSchema.safeParse(input));
    if (!(await categoryExists(db, parsed.categoryId))) {
        throw new ItemServiceError(
            404,
            "CATEGORY_NOT_FOUND",
            "category was not found",
        );
    }
    if (!(await locationExists(db, parsed.locationId))) {
        throw new ItemServiceError(
            404,
            "LOCATION_NOT_FOUND",
            "location was not found",
        );
    }
    const categoryKind = await getCategoryKind(db, parsed.categoryId);
    const isDocument = categoryKind === "document";
    const baseUnit = parsed.baseUnit ?? (isDocument ? "件" : undefined);
    const baseDimension =
        parsed.baseDimension ?? (isDocument ? "count" : undefined);
    if (!baseUnit || !baseDimension) {
        throw new ItemServiceError(
            400,
            "BASE_UNIT_REQUIRED",
            "baseUnit and baseDimension are required for this category",
        );
    }
    const currentQuantity = parsed.currentQuantity ?? (isDocument ? 1 : 0);
    const row = await createItemRecord(db, {
        ...parsed,
        baseUnit,
        baseDimension,
        currentQuantity,
    });
    return toDto(row);
};

export const updateItem = async (
    db: D1Database,
    id: string,
    input: unknown,
): Promise<ItemDto> => {
    if (id.trim().length === 0) {
        throw new ItemServiceError(400, "INVALID_ID", "id must not be empty");
    }
    const parsed = parseOrThrow(itemUpdateSchema.safeParse(input));
    const existing = await getItemRecord(db, id);
    if (!existing) {
        throw new ItemServiceError(404, "ITEM_NOT_FOUND", "item was not found");
    }
    if (parsed.categoryId && !(await categoryExists(db, parsed.categoryId))) {
        throw new ItemServiceError(
            404,
            "CATEGORY_NOT_FOUND",
            "category was not found",
        );
    }
    if (parsed.locationId && !(await locationExists(db, parsed.locationId))) {
        throw new ItemServiceError(
            404,
            "LOCATION_NOT_FOUND",
            "location was not found",
        );
    }
    if (parsed.categoryId && parsed.categoryId !== existing.categoryId) {
        const [currentCategoryKind, nextCategoryKind] = await Promise.all([
            getCategoryKind(db, existing.categoryId),
            getCategoryKind(db, parsed.categoryId),
        ]);
        if (
            isDocumentCategory(currentCategoryKind) !==
            isDocumentCategory(nextCategoryKind)
        ) {
            throw new ItemServiceError(
                409,
                "ITEM_CATEGORY_KIND_CONFLICT",
                "item category cannot cross the document and non-document boundary",
            );
        }
    }
    const row = await updateItemRecord(db, id, parsed);
    if (!row) {
        throw new ItemServiceError(404, "ITEM_NOT_FOUND", "item was not found");
    }
    return toDto(row);
};

export const deleteItem = async (db: D1Database, id: string): Promise<void> => {
    if (id.trim().length === 0) {
        throw new ItemServiceError(400, "INVALID_ID", "id must not be empty");
    }
    try {
        if (!(await deleteItemRecord(db, id))) {
            throw new ItemServiceError(
                404,
                "ITEM_NOT_FOUND",
                "item was not found",
            );
        }
    } catch (error) {
        if (isItemDeleteForeignKeyConflict(error)) {
            throw new ItemServiceError(
                409,
                "ITEM_DELETE_CONFLICT",
                "item cannot be deleted because it has stock history",
            );
        }
        throw error;
    }
};

export type { ItemCreateInput, ItemListQuery, ItemUpdateInput };
