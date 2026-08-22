import { queryOptions } from "@tanstack/react-query";
import {
    getItemDetail,
    getItemRelabelImpact,
    listAllItems,
    listCategoryTree,
    listLocationTree,
} from "./item-api";

// 先頭要素はデータセット名で揃える。保管場所マスタ側の
// invalidateQueries({ queryKey: ["locations"] }) がここのキャッシュも流せる。
export const itemKeys = {
    all: ["items"] as const,
    list: () => [...itemKeys.all, "list"] as const,
    detail: (itemId: string) => [...itemKeys.all, "detail", itemId] as const,
    // 入出庫履歴・価格記録の有無。読み取り先は別の名前空間だが、品目ページの
    // 警告にしか使わないため品目の無効化（["items"]）へ相乗りさせる
    relabelImpact: (itemId: string) =>
        [...itemKeys.all, "relabel-impact", itemId] as const,
};

export const categoryKeys = {
    all: ["categories"] as const,
    list: () => [...categoryKeys.all, "list"] as const,
};

export const locationKeys = {
    all: ["locations"] as const,
    list: () => [...locationKeys.all, "list"] as const,
};

// 在庫一覧画面は ["inventory"] 名前空間でキャッシュするため、品目の登録・更新・削除と
// 読書状態の変更でも併せて無効化する（在庫一覧は品目名・分類を表示する）
export const inventoryKeys = {
    all: ["inventory"] as const,
};

// 書籍一覧は ["books"] 名前空間でキャッシュする。カテゴリの付け替えで書籍に
// 出入りし、改名・削除・読書状態の変更も行に出るため、同じ機会に無効化する
export const bookKeys = {
    all: ["books"] as const,
};

export const itemListQueryOptions = () =>
    queryOptions({
        queryKey: itemKeys.list(),
        queryFn: () => listAllItems(),
    });

export const itemDetailQueryOptions = (itemId: string) =>
    queryOptions({
        queryKey: itemKeys.detail(itemId),
        queryFn: () => getItemDetail({ data: { itemId } }),
    });

export const itemRelabelImpactQueryOptions = (itemId: string) =>
    queryOptions({
        queryKey: itemKeys.relabelImpact(itemId),
        queryFn: () => getItemRelabelImpact({ data: { itemId } }),
    });

export const categoryListQueryOptions = () =>
    queryOptions({
        queryKey: categoryKeys.list(),
        queryFn: () => listCategoryTree(),
    });

export const locationListQueryOptions = () =>
    queryOptions({
        queryKey: locationKeys.list(),
        queryFn: () => listLocationTree(),
    });
