import { queryOptions } from "@tanstack/react-query";
import { listItemLots, listItems } from "./stock-api";

// 在庫操作の各画面は同じ key を使い、入出庫・棚卸しの後に品目一覧とロットを
// まとめて無効化する。key の形は在庫関連ルート間で一致させること。
export const itemKeys = {
    all: ["items"] as const,
    list: () => [...itemKeys.all, "list"] as const,
    lots: (itemId: string) => [...itemKeys.all, "lots", itemId] as const,
};

export const stockHistoryKeys = {
    all: ["stock-history"] as const,
};

// 在庫一覧画面は ["inventory"] 名前空間でキャッシュするため、在庫変動後は併せて無効化する
export const inventoryKeys = {
    all: ["inventory"] as const,
};

export const itemListQueryOptions = () =>
    queryOptions({
        queryKey: itemKeys.list(),
        queryFn: () => listItems(),
    });

// 品目未選択では取得しない。key に itemId を含めるため品目ごとにキャッシュされる。
export const itemLotsQueryOptions = (itemId: string) =>
    queryOptions({
        queryKey: itemKeys.lots(itemId),
        queryFn: () => listItemLots({ data: { itemId } }),
        enabled: itemId !== "",
    });
