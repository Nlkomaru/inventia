import { queryOptions } from "@tanstack/react-query";
import { listLocationItems, listLocationTree } from "./location-api";

// 在庫画面も ["locations", "tree"] を使うが、そちらは LocationDto[] を返す。
// 品目件数を持つこの画面のツリーは別 key にして取り違えを防ぎ、prefix は
// 共有してマスタ側の invalidateQueries(["locations"]) を両方へ波及させる
export const locationKeys = {
    all: ["locations"] as const,
    tree: () => [...locationKeys.all, "tree", "with-counts"] as const,
    items: (locationId: string) =>
        [...locationKeys.all, "detail", locationId, "items"] as const,
};

export const locationTreeQueryOptions = () =>
    queryOptions({
        queryKey: locationKeys.tree(),
        queryFn: () => listLocationTree(),
    });

/** 保管場所に直接置かれている品目。子孫の場所の分は含まない。 */
export const locationItemsQueryOptions = (locationId: string) =>
    queryOptions({
        queryKey: locationKeys.items(locationId),
        queryFn: () => listLocationItems({ data: locationId }),
    });
