import { createServerFn } from "@tanstack/react-start";
import {
    type CategoryCreateInput,
    type CategoryDto,
    type CategoryUpdateInput,
    categoryIdSchema,
} from "@/domain/category";
import type { ItemDto } from "@/domain/item";

/** カテゴリーの個別ページに並べる品目。一覧と同じ DTO を使う。 */
export type CategoryItemDto = ItemDto;

/** 上限で打ち切られた場合は truncated が true になる。 */
export type CategoryTreeResult = {
    items: CategoryDto[];
    truncated: boolean;
};

type ApiError = { error?: { message?: string } };

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? "カテゴリの更新に失敗しました");
    }
    return (await response.json()) as T;
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

export const createCategory = (input: CategoryCreateInput) =>
    request<CategoryDto>("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
    });

export const updateCategory = (id: string, input: CategoryUpdateInput) =>
    request<CategoryDto>(`/api/categories/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
    });

export const deleteCategory = (id: string) =>
    request<{ deleted: true }>(`/api/categories/${id}`, { method: "DELETE" });

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
