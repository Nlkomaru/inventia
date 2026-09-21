import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
    type CategoryCreateInput,
    type CategoryDto,
    type CategoryUpdateInput,
    categoryCreateInputSchema,
    categoryIdSchema,
    categoryUpdateInputSchema,
} from "@/domain/category";
import type { ItemDto } from "@/domain/item";

/** カテゴリーの個別ページに並べる品目。一覧と同じ DTO を使う。 */
export type CategoryItemDto = ItemDto;

/** 上限で打ち切られた場合は truncated が true になる。 */
export type CategoryTreeResult = {
    items: CategoryDto[];
    truncated: boolean;
};

export const listCategoryTree = createServerFn({ method: "GET" }).handler(
    async (): Promise<CategoryTreeResult> => {
        const [{ env }, { listCategoryTree: fetchCategoryTree }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/categoryService"),
            ]);
        return await fetchCategoryTree(env.DB);
    },
);

// 更新も読み取りと同じ server function 境界から service を直接呼ぶ。
// 画面は API トークンを持たず、/api の HTTP 経路を通らない。
const createCategoryServerFn = createServerFn({ method: "POST" })
    .validator(categoryCreateInputSchema)
    .handler(async ({ data }): Promise<CategoryDto> => {
        const [{ env }, { createCategory: create, CategoryServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/categoryService"),
            ]);
        try {
            return await create(env.DB, data);
        } catch (error) {
            if (error instanceof CategoryServiceError) {
                throw new Error(error.message);
            }
            throw new Error("カテゴリの更新に失敗しました");
        }
    });

const updateCategoryServerFn = createServerFn({ method: "POST" })
    .validator(
        z.object({
            id: categoryIdSchema,
            input: categoryUpdateInputSchema,
        }),
    )
    .handler(async ({ data }): Promise<CategoryDto> => {
        const [{ env }, { updateCategory: update, CategoryServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/categoryService"),
            ]);
        try {
            return await update(env.DB, data.id, data.input);
        } catch (error) {
            if (error instanceof CategoryServiceError) {
                throw new Error(error.message);
            }
            throw new Error("カテゴリの更新に失敗しました");
        }
    });

const deleteCategoryServerFn = createServerFn({ method: "POST" })
    .validator(categoryIdSchema)
    .handler(async ({ data }): Promise<{ deleted: true }> => {
        const [{ env }, { removeCategory, CategoryServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/categoryService"),
            ]);
        try {
            await removeCategory(env.DB, data);
            return { deleted: true };
        } catch (error) {
            if (error instanceof CategoryServiceError) {
                throw new Error(error.message);
            }
            throw new Error("カテゴリの更新に失敗しました");
        }
    });

export const createCategory = (
    input: CategoryCreateInput,
): Promise<CategoryDto> => createCategoryServerFn({ data: input });

export const updateCategory = (
    id: string,
    input: CategoryUpdateInput,
): Promise<CategoryDto> => updateCategoryServerFn({ data: { id, input } });

export const deleteCategory = (id: string): Promise<{ deleted: true }> =>
    deleteCategoryServerFn({ data: id });

/**
 * カテゴリー 1 つに直接紐づく品目。下位カテゴリーの分は含めない
 * （階層をまたぐ合算はカテゴリーツリーを持つ画面側の責務、という service の分担に合わせる）。
 */
export const listCategoryItems = createServerFn({ method: "GET" })
    .validator((input: unknown) => categoryIdSchema.parse(input))
    .handler(async ({ data }): Promise<CategoryItemDto[]> => {
        const [{ env }, { listItems }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/itemService"),
        ]);
        const items: CategoryItemDto[] = [];
        let cursor: string | undefined;
        do {
            const page = await listItems(env.DB, {
                categoryId: data,
                limit: 100,
                cursor,
            });
            items.push(...page.items);
            cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return items;
    });
