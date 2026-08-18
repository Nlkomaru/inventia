import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { ReceiptStatus } from "@/domain/receipt";
import {
    getReceiptDetail,
    listAllItems,
    listCategoryTree,
    listLocationTree,
    listReceiptsPage,
} from "./receipt-api";

// 先頭要素はデータセット名で揃える。品目・カテゴリ・保管場所は他画面と同じ
// 名前空間を使い、片方の更新でもう片方のキャッシュが流れるようにする。
export const receiptKeys = {
    all: ["receipts"] as const,
    lists: () => [...receiptKeys.all, "list"] as const,
    list: (filters: ReceiptListFilters) =>
        [...receiptKeys.lists(), filters] as const,
    detail: (receiptId: string) =>
        [...receiptKeys.all, "detail", receiptId] as const,
};

export const itemKeys = {
    all: ["items"] as const,
    list: () => [...itemKeys.all, "list"] as const,
};

export const categoryKeys = {
    all: ["categories"] as const,
    list: () => [...categoryKeys.all, "list"] as const,
};

export const locationKeys = {
    all: ["locations"] as const,
    list: () => [...locationKeys.all, "list"] as const,
};

// 反映は在庫を動かすため、在庫一覧と在庫履歴のキャッシュも無効化する
export const inventoryKeys = {
    all: ["inventory"] as const,
};

export const stockHistoryKeys = {
    all: ["stock-history"] as const,
};

export interface ReceiptListFilters {
    status?: ReceiptStatus;
}

export const receiptPageSize = 20;

/** 取込履歴は cursor ページング。絞り込みを変えると先頭ページから読み直す。 */
export const receiptListQueryOptions = (filters: ReceiptListFilters) =>
    infiniteQueryOptions({
        queryKey: receiptKeys.list(filters),
        queryFn: ({ pageParam }) =>
            listReceiptsPage({
                data: {
                    ...(filters.status === undefined
                        ? {}
                        : { status: filters.status }),
                    ...(pageParam === null ? {} : { cursor: pageParam }),
                    limit: receiptPageSize,
                },
            }),
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
    });

// 未アップロード時は取得しない。key に receiptId を含めるためレシートごとにキャッシュされる。
export const receiptDetailQueryOptions = (receiptId: string) =>
    queryOptions({
        queryKey: receiptKeys.detail(receiptId),
        queryFn: () => getReceiptDetail({ data: { receiptId } }),
        enabled: receiptId !== "",
    });

export const itemListQueryOptions = () =>
    queryOptions({
        queryKey: itemKeys.list(),
        queryFn: () => listAllItems(),
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
