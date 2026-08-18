import {
    type CategoryCreateInput,
    type CategoryDto,
    type CategoryId,
    type CategoryListInput,
    type CategoryUpdateInput,
    categoryCreateInputSchema,
    categoryIdSchema,
    categoryListInputSchema,
    categoryUpdateInputSchema,
    decodeCategoryCursor,
    encodeCategoryCursor,
} from "../domain/category";
import { newId } from "../domain/id";
import {
    type CategoryRecord,
    deleteCategory as deleteCategoryRow,
    findCategoryById,
    findSiblingByName,
    hasChildren,
    hasDescendant,
    hasReferencingItems,
    insertCategory,
    listAllCategories,
    listCategories as listCategoryRows,
    parentExists,
    updateCategory as updateCategoryRow,
} from "../repositories/categoryRepository";

export type CategoryServiceErrorCode =
    | "CATEGORY_INVALID_INPUT"
    | "CATEGORY_INVALID_CURSOR"
    | "CATEGORY_NOT_FOUND"
    | "CATEGORY_PARENT_NOT_FOUND"
    | "CATEGORY_NAME_CONFLICT"
    | "CATEGORY_PARENT_CYCLE"
    | "CATEGORY_HAS_CHILDREN"
    | "CATEGORY_IN_USE"
    | "CATEGORY_CONFLICT"
    | "CATEGORY_INTERNAL";

const statusByCode: Record<CategoryServiceErrorCode, number> = {
    CATEGORY_INVALID_INPUT: 400,
    CATEGORY_INVALID_CURSOR: 400,
    CATEGORY_NOT_FOUND: 404,
    CATEGORY_PARENT_NOT_FOUND: 422,
    CATEGORY_NAME_CONFLICT: 409,
    CATEGORY_PARENT_CYCLE: 422,
    CATEGORY_HAS_CHILDREN: 409,
    CATEGORY_IN_USE: 409,
    CATEGORY_CONFLICT: 409,
    CATEGORY_INTERNAL: 500,
};

export class CategoryServiceError extends Error {
    readonly status: number;

    constructor(
        readonly code: CategoryServiceErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "CategoryServiceError";
        this.status = statusByCode[code];
    }
}

const invalidInput = (
    message = "入力値を確認してください",
): CategoryServiceError =>
    new CategoryServiceError("CATEGORY_INVALID_INPUT", message);

const isConstraintViolation = (error: unknown): boolean =>
    /constraint|unique|foreign key/i.test(
        error instanceof Error ? error.message : String(error),
    );

const parseCreateInput = (input: unknown): CategoryCreateInput => {
    const result = categoryCreateInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput(
            "カテゴリ名、親カテゴリ、種別、並び順を確認してください",
        );
    }
    return result.data;
};

const parseUpdateInput = (input: unknown): CategoryUpdateInput => {
    const result = categoryUpdateInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput(
            "更新するカテゴリ名、親カテゴリ、種別、並び順を確認してください",
        );
    }
    return result.data;
};

const parseCategoryId = (id: unknown): CategoryId => {
    const result = categoryIdSchema.safeParse(id);
    if (!result.success) {
        throw invalidInput("カテゴリIDを確認してください");
    }
    return result.data;
};

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

const ensureParentExists = async (
    db: D1Database,
    parentId: CategoryId | null,
): Promise<void> => {
    if (parentId !== null && !(await parentExists(db, parentId))) {
        throw new CategoryServiceError(
            "CATEGORY_PARENT_NOT_FOUND",
            "指定された親カテゴリが見つかりません",
        );
    }
};

// uq_categories_parent_name は parent_id が NULL のルート同士を守れないため、
// 階層内の同名判定は必ず service で行う
const ensureSiblingNameFree = async (
    db: D1Database,
    parentId: CategoryId | null,
    name: string,
    excludeId?: CategoryId,
): Promise<void> => {
    if (await findSiblingByName(db, parentId, name, excludeId)) {
        throw new CategoryServiceError(
            "CATEGORY_NAME_CONFLICT",
            "同じ階層に同名のカテゴリが既に存在します",
        );
    }
};

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

// ツリー表示は全件が必要なため、階層ごとのページングを繰り返さず 1 クエリで読む
export const categoryTreeMaxSize = 1000;

export type CategoryTreeResponse = {
    items: CategoryDto[];
    truncated: boolean;
};

export const listCategoryTree = async (
    db: D1Database,
): Promise<CategoryTreeResponse> => {
    const page = await listAllCategories(db, categoryTreeMaxSize);
    return { items: page.rows.map(toDto), truncated: page.hasMore };
};

export const getCategory = async (
    db: D1Database,
    id: unknown,
): Promise<CategoryDto> => {
    const categoryId = parseCategoryId(id);
    const row = await findCategoryById(db, categoryId);
    if (!row) {
        throw new CategoryServiceError(
            "CATEGORY_NOT_FOUND",
            "指定されたカテゴリが見つかりません",
        );
    }
    return toDto(row);
};

export const createCategory = async (
    db: D1Database,
    input: unknown,
): Promise<CategoryDto> => {
    const parsed = parseCreateInput(input);
    await ensureParentExists(db, parsed.parentId);
    await ensureSiblingNameFree(db, parsed.parentId, parsed.name);

    const now = new Date().toISOString();
    const id = newId();
    try {
        const row = await insertCategory(db, {
            id,
            name: parsed.name,
            parentId: parsed.parentId,
            kind: parsed.kind,
            sortOrder: parsed.sortOrder,
            createdAt: now,
            updatedAt: now,
        });
        return toDto(row);
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw new CategoryServiceError(
                "CATEGORY_NAME_CONFLICT",
                "同じ階層に同名のカテゴリが既に存在します",
            );
        }
        throw error;
    }
};

export const updateCategory = async (
    db: D1Database,
    id: unknown,
    input: unknown,
): Promise<CategoryDto> => {
    const categoryId = parseCategoryId(id);
    const parsed = parseUpdateInput(input);
    const current = await findCategoryById(db, categoryId);
    if (!current) {
        throw new CategoryServiceError(
            "CATEGORY_NOT_FOUND",
            "指定されたカテゴリが見つかりません",
        );
    }

    const nextParentId =
        parsed.parentId === undefined ? current.parentId : parsed.parentId;
    await ensureParentExists(db, nextParentId);
    if (nextParentId === categoryId) {
        throw new CategoryServiceError(
            "CATEGORY_PARENT_CYCLE",
            "カテゴリを自分自身の親には設定できません",
        );
    }
    if (
        nextParentId !== null &&
        (await hasDescendant(db, categoryId, nextParentId))
    ) {
        throw new CategoryServiceError(
            "CATEGORY_PARENT_CYCLE",
            "子孫のカテゴリを親には設定できません",
        );
    }

    const nextName = parsed.name ?? current.name;
    await ensureSiblingNameFree(db, nextParentId, nextName, categoryId);

    try {
        const row = await updateCategoryRow(
            db,
            categoryId,
            parsed,
            new Date().toISOString(),
        );
        return toDto(row);
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw new CategoryServiceError(
                "CATEGORY_CONFLICT",
                "カテゴリを更新できませんでした。内容を確認して再試行してください",
            );
        }
        throw error;
    }
};

export const removeCategory = async (
    db: D1Database,
    id: unknown,
): Promise<void> => {
    const categoryId = parseCategoryId(id);
    if (!(await findCategoryById(db, categoryId))) {
        throw new CategoryServiceError(
            "CATEGORY_NOT_FOUND",
            "指定されたカテゴリが見つかりません",
        );
    }
    if (await hasChildren(db, categoryId)) {
        throw new CategoryServiceError(
            "CATEGORY_HAS_CHILDREN",
            "子カテゴリがあるため削除できません。先に子カテゴリを移動または削除してください",
        );
    }
    if (await hasReferencingItems(db, categoryId)) {
        throw new CategoryServiceError(
            "CATEGORY_IN_USE",
            "商品が参照しているため削除できません。先に商品のカテゴリを変更してください",
        );
    }
    try {
        await deleteCategoryRow(db, categoryId);
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw new CategoryServiceError(
                "CATEGORY_IN_USE",
                "参照中のため削除できません。先に参照を解除してください",
            );
        }
        throw error;
    }
};
