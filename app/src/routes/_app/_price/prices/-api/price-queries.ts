import { infiniteQueryOptions } from "@tanstack/react-query";
import { listAllPriceRecords } from "./price-api";

// 価格はレシート反映でも増えるため、品目ごとの履歴と同じ `prices` 名前空間へ入れ、
// invalidateQueries(["prices"]) で両方を流せるようにする。`list` は品目ごとの
// 履歴（["prices", "item", itemId]）とは別の階層にして、互いのページ位置を
// 巻き戻さないようにする
export const priceRecordKeys = {
    all: ["prices"] as const,
    list: () => [...priceRecordKeys.all, "list"] as const,
};

export const priceRecordPageSize = 30;

/** 全品目の価格記録。cursor ページングで、並びは記録日時の新しい順。 */
export const priceRecordListQueryOptions = () =>
    infiniteQueryOptions({
        queryKey: priceRecordKeys.list(),
        queryFn: ({ pageParam }) =>
            listAllPriceRecords({
                data: {
                    ...(pageParam === null ? {} : { cursor: pageParam }),
                    limit: priceRecordPageSize,
                },
            }),
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
    });
