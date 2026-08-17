import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { StockMovementReason } from "@/domain/stock";
import { listItems, listStockHistory } from "./stock-api";

// 在庫操作の各画面は同じ key を使い、入出庫・棚卸しの後に品目一覧とロットを
// まとめて無効化する。key の形は在庫関連ルート間で一致させること。
export const itemKeys = {
    all: ["items"] as const,
    list: () => [...itemKeys.all, "list"] as const,
};

export interface StockHistoryFilters {
    itemId?: string;
    reason?: StockMovementReason;
}

export const stockHistoryKeys = {
    all: ["stock-history"] as const,
    list: (filters: StockHistoryFilters) =>
        [...stockHistoryKeys.all, "list", filters] as const,
};

export const historyPageSize = 50;

export const itemListQueryOptions = () =>
    queryOptions({
        queryKey: itemKeys.list(),
        queryFn: () => listItems(),
    });

// cursor ページング。絞り込みを変えると key が変わるため、先頭ページから読み直す。
export const stockHistoryQueryOptions = (filters: StockHistoryFilters) =>
    infiniteQueryOptions({
        queryKey: stockHistoryKeys.list(filters),
        queryFn: ({ pageParam }) =>
            listStockHistory({
                data: {
                    ...(filters.itemId === undefined
                        ? {}
                        : { itemId: filters.itemId }),
                    ...(filters.reason === undefined
                        ? {}
                        : { reason: filters.reason }),
                    ...(pageParam === null ? {} : { cursor: pageParam }),
                    limit: historyPageSize,
                },
            }),
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
    });
