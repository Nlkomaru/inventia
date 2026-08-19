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

// 入出庫・棚卸・レシート反映は `stock-history` 名前空間をまとめて無効化するため、
// この画面の履歴もその配下へ入れる。`list` とは別の階層にして、
// 履歴一覧（絞り込みつき）と品目ごとの履歴が互いのページ位置を巻き戻さないようにする
export const itemStockHistoryKeys = {
    all: ["stock-history"] as const,
    item: (itemId: string) =>
        [...itemStockHistoryKeys.all, "item", itemId] as const,
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
        queryKey: itemStockHistoryKeys.item(itemId),
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
