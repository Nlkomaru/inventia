import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import {
    fetchCategory,
    fetchItemDetail,
    fetchLocation,
    listItemPriceRecords,
    listItemStockHistory,
    listStoreOptions,
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

// 価格はレシート反映でも増えるため、品目ごとの履歴を `prices` 名前空間の配下へ置く
export const itemPriceRecordKeys = {
    all: ["prices"] as const,
    item: (itemId: string) =>
        [...itemPriceRecordKeys.all, "item", itemId] as const,
};

// 在庫の変更は在庫一覧の集計にも効くため、入庫の後にまとめて無効化する
export const inventoryKeys = {
    all: ["inventory"] as const,
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

/** 価格履歴も cursor ページング。並びは記録日時の新しい順。 */
export const itemPriceRecordsQueryOptions = (itemId: string) =>
    infiniteQueryOptions({
        queryKey: itemPriceRecordKeys.item(itemId),
        queryFn: ({ pageParam }) =>
            listItemPriceRecords({
                data: {
                    itemId,
                    ...(pageParam === null ? {} : { cursor: pageParam }),
                    limit: itemHistoryPageSize,
                },
            }),
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
    });

// 店舗マスタと同じ名前空間を共有し、マスタ側の invalidateQueries(["stores"]) を波及させる
export const storeKeys = {
    all: ["stores"] as const,
    options: () => [...storeKeys.all, "options"] as const,
};

/** 価格フォームの店舗選択肢。 */
export const storeOptionsQueryOptions = () =>
    queryOptions({
        queryKey: storeKeys.options(),
        queryFn: () => listStoreOptions(),
    });
