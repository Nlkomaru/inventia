import type { BookReadingListDto } from "../domain/item";
import {
    bookReadingListQuerySchema,
    type ReadingStateDto,
    readingStateUpsertSchema,
    toReadingStateDto,
    validateReadingState,
} from "../domain/reading";
import {
    getCategoryKind,
    getItem as getItemRecord,
    InvalidItemCursorError,
    listBookItems,
} from "../repositories/itemRepository";
import {
    deleteReadingState as deleteReadingStateRecord,
    getReadingState as getReadingStateRecord,
    listReadingStatesByItemIds,
    upsertReadingState as upsertReadingStateRecord,
} from "../repositories/readingRepository";
import { toItemDto } from "./itemService";

export class ReadingServiceError extends Error {
    readonly status: 400 | 404 | 409;
    readonly code: string;

    constructor(status: 400 | 404 | 409, code: string, message: string) {
        super(message);
        this.name = "ReadingServiceError";
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
        throw new ReadingServiceError(
            400,
            "VALIDATION_ERROR",
            validationMessage(result.error.issues),
        );
    }
    return result.data;
};

const normalizeItemId = (itemId: string): string => {
    const normalized = itemId.trim();
    if (normalized.length === 0) {
        throw new ReadingServiceError(
            400,
            "INVALID_ID",
            "item id must not be empty",
        );
    }
    return normalized;
};

const requireItemCategoryId = async (
    db: D1Database,
    itemId: string,
): Promise<string> => {
    const item = await getItemRecord(db, itemId);
    if (!item) {
        throw new ReadingServiceError(
            404,
            "ITEM_NOT_FOUND",
            "item was not found",
        );
    }
    return item.categoryId;
};

/**
 * 読書状態を取得する。書籍以外の品目は読書状態を持てないため常に null になり、
 * 種別の確認だけのために追加のクエリを投げない。
 */
export const getReadingState = async (
    db: D1Database,
    itemId: string,
): Promise<ReadingStateDto | null> => {
    const normalizedItemId = normalizeItemId(itemId);
    await requireItemCategoryId(db, normalizedItemId);
    const row = await getReadingStateRecord(db, normalizedItemId);
    return row ? toReadingStateDto(row) : null;
};

/**
 * 読書状態を upsert する。実効カテゴリー種別が `book` の品目だけが対象で、
 * 省略した日時は null として保存する（部分更新ではない）。
 */
export const setReadingState = async (
    db: D1Database,
    itemId: string,
    input: unknown,
): Promise<ReadingStateDto> => {
    const normalizedItemId = normalizeItemId(itemId);
    const parsed = parseOrThrow(readingStateUpsertSchema.safeParse(input));
    const categoryId = await requireItemCategoryId(db, normalizedItemId);
    // 祖先を遡って解決した実効種別で判定する
    if ((await getCategoryKind(db, categoryId)) !== "book") {
        throw new ReadingServiceError(
            409,
            "NOT_A_BOOK_ITEM",
            "reading state is available only for items in a book category",
        );
    }
    const startedAt = parsed.startedAt ?? null;
    const finishedAt = parsed.finishedAt ?? null;
    // DB の CHECK に到達する前に同じ規則で検証し、内部例外ではなく直せるエラーを返す
    const validation = validateReadingState({
        status: parsed.status,
        startedAt,
        finishedAt,
    });
    if (!validation.valid) {
        throw new ReadingServiceError(
            400,
            "INVALID_READING_DATES",
            validation.message,
        );
    }
    const saved = await upsertReadingStateRecord(db, {
        itemId: normalizedItemId,
        status: parsed.status,
        startedAt,
        finishedAt,
    });
    return toReadingStateDto(saved);
};

/**
 * 読書状態を削除する。在庫とロットには影響しない。
 * カテゴリー種別は確認しない。書籍以外へのカテゴリー変更は読書状態が残っている限り
 * itemService が拒否するため、この削除は種別に関わらず実行できる必要がある。
 */
export const clearReadingState = async (
    db: D1Database,
    itemId: string,
): Promise<void> => {
    const normalizedItemId = normalizeItemId(itemId);
    await requireItemCategoryId(db, normalizedItemId);
    // 読書状態が無い品目への削除は成功として扱う（再送で結果が変わらない）
    await deleteReadingStateRecord(db, normalizedItemId);
};

/**
 * 実効カテゴリー種別が `book` の品目とその読書状態を、品目一覧と同じ (name, id) 順で返す。
 * `status` を指定した場合はその状態が保存されている品目だけを返すため、
 * 読書状態が未設定の書籍は含まれない。
 */
export const listBookReadingStates = async (
    db: D1Database,
    input: unknown,
): Promise<BookReadingListDto> => {
    const query = parseOrThrow(bookReadingListQuerySchema.safeParse(input));
    try {
        const result = await listBookItems(db, query);
        // 読書状態はページに並んだ品目 id の IN 句 1 回で解決する（N+1 禁止）
        const readingStates = await listReadingStatesByItemIds(
            db,
            result.items.map((row) => row.id),
        );
        return {
            items: result.items.map((row) => {
                const reading = readingStates.get(row.id) ?? null;
                return {
                    ...toItemDto(row, reading?.status ?? null),
                    readingState: reading ? toReadingStateDto(reading) : null,
                };
            }),
            nextCursor: result.nextCursor,
        };
    } catch (error) {
        if (error instanceof InvalidItemCursorError) {
            throw new ReadingServiceError(
                400,
                "INVALID_CURSOR",
                "cursor is invalid",
            );
        }
        throw error;
    }
};
