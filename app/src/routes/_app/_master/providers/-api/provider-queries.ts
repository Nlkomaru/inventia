import { queryOptions } from "@tanstack/react-query";
import { listProviders } from "./provider-api";

// 先頭要素はデータセット名で揃える。在庫の出庫画面が連携先を選べるように
// なっても、invalidateQueries(["providers"]) で両方を流せる
export const providerKeys = {
    all: ["providers"] as const,
    list: () => [...providerKeys.all, "list"] as const,
};

export const providerListQueryOptions = () =>
    queryOptions({
        queryKey: providerKeys.list(),
        queryFn: () => listProviders(),
    });
