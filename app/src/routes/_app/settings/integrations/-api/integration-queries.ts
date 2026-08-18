import { queryOptions } from "@tanstack/react-query";
import { getOpenRouterStatus, listOpenRouterModels } from "./integration-api";

export const integrationKeys = {
    all: ["integrations"] as const,
    openRouterStatus: () =>
        [...integrationKeys.all, "openrouter", "status"] as const,
    openRouterModels: () =>
        [...integrationKeys.all, "openrouter", "models"] as const,
};

export const openRouterStatusQueryOptions = () =>
    queryOptions({
        queryKey: integrationKeys.openRouterStatus(),
        queryFn: () => getOpenRouterStatus(),
    });

export const openRouterModelsQueryOptions = () =>
    queryOptions({
        queryKey: integrationKeys.openRouterModels(),
        queryFn: () => listOpenRouterModels(),
        // 上流 HTTP に依存するため失敗し得る。失敗表示を遅らせないよう 1 回で確定させる
        // (loader の prefetchQuery 側も既定で retry しないため、両者の試行回数を揃える)。
        retry: false,
        // OpenRouter のモデル一覧はほとんど変化せず、上流への往復も重いため既定より長く保つ。
        staleTime: 5 * 60_000,
    });
