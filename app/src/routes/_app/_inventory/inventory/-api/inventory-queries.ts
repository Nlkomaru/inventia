import { queryOptions } from "@tanstack/react-query";
import {
    fetchCategoryTree,
    fetchInventoryItems,
    fetchLocationTree,
    type InventoryItemFilters,
    listLotsForItems,
} from "./inventory-api";

export const inventoryKeys = {
    all: ["inventory"] as const,
    items: (filters: InventoryItemFilters) =>
        [...inventoryKeys.all, "items", filters] as const,
    lots: (itemIds: readonly string[]) =>
        [...inventoryKeys.all, "lots", itemIds] as const,
};

// 保管場所とカテゴリの一覧はマスタ画面と同じ key を共有する。
// マスタ側の更新が invalidateQueries(["locations"]) / (["categories"]) で
// この画面のラベルにも波及するようにするため、`inventory` 名前空間へ入れない
export const locationKeys = {
    all: ["locations"] as const,
    tree: () => [...locationKeys.all, "tree"] as const,
};

export const categoryKeys = {
    all: ["categories"] as const,
    tree: () => [...categoryKeys.all, "tree"] as const,
};

export const inventoryItemsQueryOptions = (filters: InventoryItemFilters) =>
    queryOptions({
        queryKey: inventoryKeys.items(filters),
        queryFn: () => fetchInventoryItems({ data: filters }),
    });

export const locationTreeQueryOptions = () =>
    queryOptions({
        queryKey: locationKeys.tree(),
        queryFn: () => fetchLocationTree(),
    });

export const categoryTreeQueryOptions = () =>
    queryOptions({
        queryKey: categoryKeys.tree(),
        queryFn: () => fetchCategoryTree(),
    });

// 内訳は品目ごとの追加取得になるため loader では待たず、一覧の表示後に読み込む
export const itemLotsQueryOptions = (itemIds: readonly string[]) =>
    queryOptions({
        queryKey: inventoryKeys.lots(itemIds),
        queryFn: () => listLotsForItems(itemIds),
        enabled: itemIds.length > 0,
    });
