import { queryOptions } from "@tanstack/react-query";
import { listCategoryItems, listCategoryTree } from "./category-api";

// 先頭要素は他画面と同じ "categories" にし、片方の更新でもう片方のキャッシュを流す
export const categoryKeys = {
    all: ["categories"] as const,
    tree: () => [...categoryKeys.all, "tree"] as const,
    items: (categoryId: string) =>
        [...categoryKeys.all, "detail", categoryId, "items"] as const,
};

export const categoryTreeQueryOptions = () =>
    queryOptions({
        queryKey: categoryKeys.tree(),
        queryFn: () => listCategoryTree(),
    });

/** カテゴリーに直接紐づく品目。下位カテゴリーの分は含まない。 */
export const categoryItemsQueryOptions = (categoryId: string) =>
    queryOptions({
        queryKey: categoryKeys.items(categoryId),
        queryFn: () => listCategoryItems({ data: categoryId }),
    });
