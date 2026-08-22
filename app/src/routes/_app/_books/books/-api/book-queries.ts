import { queryOptions } from "@tanstack/react-query";
import { listAllBookReadingStates } from "./book-api";

// 先頭要素はデータセット名で揃える。品目マスタ側の
// invalidateQueries({ queryKey: ["books"] }) がここのキャッシュも流せる。
export const bookKeys = {
    all: ["books"] as const,
    list: () => [...bookKeys.all, "list"] as const,
};

// 読書状態の変更は品目一覧（readingStatus 列）と在庫一覧の行にも波及するため、
// 書籍ページの更新でも併せて無効化する
export const itemKeys = {
    all: ["items"] as const,
};

export const inventoryKeys = {
    all: ["inventory"] as const,
};

export const bookReadingListQueryOptions = () =>
    queryOptions({
        queryKey: bookKeys.list(),
        queryFn: () => listAllBookReadingStates(),
    });
