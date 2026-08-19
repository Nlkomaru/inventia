import { queryOptions } from "@tanstack/react-query";
import { listCategoryTree, listItems, listLocationTree } from "./stock-api";

// 在庫操作の各画面は同じ key を使い、入出庫・棚卸しの後に品目一覧とロットを
// まとめて無効化する。key の形は在庫関連ルート間で一致させること。
export const itemKeys = {
    all: ["items"] as const,
    list: () => [...itemKeys.all, "list"] as const,
};

export const stockHistoryKeys = {
    all: ["stock-history"] as const,
};

// 在庫一覧画面は ["inventory"] 名前空間でキャッシュするため、在庫変動後は併せて無効化する
export const inventoryKeys = {
    all: ["inventory"] as const,
};

// カテゴリと保管場所はマスタ画面と同じ名前空間を共有し、
// マスタ側の invalidateQueries(["categories"]) / (["locations"]) をここへも波及させる
export const categoryKeys = {
    all: ["categories"] as const,
    tree: () => [...categoryKeys.all, "tree"] as const,
};

export const locationKeys = {
    all: ["locations"] as const,
    tree: () => [...locationKeys.all, "tree"] as const,
};

export const categoryTreeQueryOptions = () =>
    queryOptions({
        queryKey: categoryKeys.tree(),
        queryFn: () => listCategoryTree(),
    });

export const locationTreeQueryOptions = () =>
    queryOptions({
        queryKey: locationKeys.tree(),
        queryFn: () => listLocationTree(),
    });

export const itemListQueryOptions = () =>
    queryOptions({
        queryKey: itemKeys.list(),
        queryFn: () => listItems(),
    });
