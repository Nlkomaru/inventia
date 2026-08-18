import { queryOptions } from "@tanstack/react-query";
import { listCategoryTree } from "./category-api";

// 先頭要素は他画面と同じ "categories" にし、片方の更新でもう片方のキャッシュを流す
export const categoryKeys = {
    all: ["categories"] as const,
    tree: () => [...categoryKeys.all, "tree"] as const,
};

export const categoryTreeQueryOptions = () =>
    queryOptions({
        queryKey: categoryKeys.tree(),
        queryFn: () => listCategoryTree(),
    });
