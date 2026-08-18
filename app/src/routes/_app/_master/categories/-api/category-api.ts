import { createServerFn } from "@tanstack/react-start";
import type {
    CategoryCreateInput,
    CategoryDto,
    CategoryUpdateInput,
} from "@/domain/category";

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
