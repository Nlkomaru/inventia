import { queryOptions } from "@tanstack/react-query";
import { listApiTokens } from "./token-api";

export const apiTokenKeys = {
    all: ["api-tokens"] as const,
    list: () => [...apiTokenKeys.all, "list"] as const,
};

export const apiTokensQueryOptions = () =>
    queryOptions({
        queryKey: apiTokenKeys.list(),
        queryFn: () => listApiTokens(),
        // 発行・失効の直後に自分で無効化するため、勝手な再取得はさせない
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
    });
