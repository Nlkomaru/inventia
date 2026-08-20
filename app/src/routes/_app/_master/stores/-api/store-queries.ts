import { queryOptions } from "@tanstack/react-query";
import { listAllStores } from "./store-api";

// 先頭要素はデータセット名で揃える。価格の一覧が店舗名やファビコンを表示する
// ようになっても、invalidateQueries(["stores"]) で両方を流せる
export const storeKeys = {
    all: ["stores"] as const,
    list: () => [...storeKeys.all, "list"] as const,
};

export const storeListQueryOptions = () =>
    queryOptions({
        queryKey: storeKeys.list(),
        queryFn: () => listAllStores(),
    });
