import {
    type CategoryDto,
    type CategoryListInput,
    categoryListInputSchema,
    decodeCategoryCursor,
    encodeCategoryCursor,
} from "../domain/category";
import {
    type CategoryRecord,
    listCategories as listCategoryRows,
} from "../repositories/categoryRepository";

export type CategoryServiceErrorCode =
    | "CATEGORY_INVALID_INPUT"
    | "CATEGORY_INVALID_CURSOR";

const statusByCode: Record<CategoryServiceErrorCode, 400> = {
    CATEGORY_INVALID_INPUT: 400,
    CATEGORY_INVALID_CURSOR: 400,
};

export class CategoryServiceError extends Error {
    readonly status: 400;

    constructor(
        readonly code: CategoryServiceErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "CategoryServiceError";
        this.status = statusByCode[code];
    }
}

const parseListInput = (input: unknown): CategoryListInput => {
    const result = categoryListInputSchema.safeParse(input);
    if (!result.success) {
        throw new CategoryServiceError(
            "CATEGORY_INVALID_INPUT",
            "parentId、limit、cursorを確認してください",
        );
    }
    return result.data;
};

const toDto = (row: CategoryRecord): CategoryDto => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    kind: row.kind,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

export type CategoryListResponse = {
    items: CategoryDto[];
    nextCursor: string | null;
};

export const listCategories = async (
    db: D1Database,
    input: unknown = {},
): Promise<CategoryListResponse> => {
    const query = parseListInput(input);
    const cursor = query.cursor ? decodeCategoryCursor(query.cursor) : null;
    if (query.cursor && (!cursor || cursor.parentId !== query.parentId)) {
        throw new CategoryServiceError(
            "CATEGORY_INVALID_CURSOR",
            "cursorが不正です。同じ親カテゴリの一覧で取得したcursorを使用してください",
        );
    }
    const page = await listCategoryRows(db, {
        parentId: query.parentId,
        limit: query.limit,
        cursor,
    });
    const items = page.rows.map(toDto);
    const last = page.rows.at(-1);
    return {
        items,
        nextCursor:
            page.hasMore && last
                ? encodeCategoryCursor({
                      parentId: query.parentId,
                      sortOrder: last.sortOrder,
                      id: last.id,
                  })
                : null,
    };
};
