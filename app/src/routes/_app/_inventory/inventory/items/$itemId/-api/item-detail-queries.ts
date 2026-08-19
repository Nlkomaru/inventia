import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import {
    fetchCategory,
    fetchItemDetail,
    fetchLocation,
    listItemStockHistory,
} from "./item-detail-api";

// 品目の詳細は在庫操作の後に無効化したいため、在庫関連ルートと同じ `items` 名前空間へ入れる
export const itemKeys = {
    all: ["items"] as const,
    detail: (itemId: string) => [...itemKeys.all, "detail", itemId] as const,
};

// カテゴリと保管場所はマスタ画面と同じ名前空間を共有し、
// マスタ側の invalidateQueries(["categories"]) / (["locations"]) をここへも波及させる
export const categoryKeys = {
    all: ["categories"] as const,
    detail: (id: string) => [...categoryKeys.all, "detail", id] as const,
};

export const locationKeys = {
    all: ["locations"] as const,
    detail: (id: string) => [...locationKeys.all, "detail", id] as const,
};

// 履歴一覧の画面（絞り込みつき）とは別の key にして、片方の再取得が
// もう片方のページ位置を巻き戻さないようにする
export const itemStockHistoryKeys = {
    all: ["item-stock-history"] as const,
    list: (itemId: string) =>
        [...itemStockHistoryKeys.all, "list", itemId] as const,
};

export const itemHistoryPageSize = 20;

export const itemDetailQueryOptions = (itemId: string) =>
    queryOptions({
        queryKey: itemKeys.detail(itemId),
        queryFn: () => fetchItemDetail({ data: { itemId } }),
    });

export const categoryDetailQueryOptions = (id: string) =>
    queryOptions({
        queryKey: categoryKeys.detail(id),
        queryFn: () => fetchCategory({ data: { id } }),
    });

export const locationDetailQueryOptions = (id: string) =>
    queryOptions({
        queryKey: locationKeys.detail(id),
        queryFn: () => fetchLocation({ data: { id } }),
    });

/** cursor ページング。品目ごとに key が変わるため、品目を移ると先頭から読む。 */
export const itemStockHistoryQueryOptions = (itemId: string) =>
    infiniteQueryOptions({
        queryKey: itemStockHistoryKeys.list(itemId),
        queryFn: ({ pageParam }) =>
            listItemStockHistory({
                data: {
                    itemId,
                    ...(pageParam === null ? {} : { cursor: pageParam }),
                    limit: itemHistoryPageSize,
                },
            }),
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
    });
