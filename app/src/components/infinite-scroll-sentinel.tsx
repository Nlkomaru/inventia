"use client";

import { useEffect, useRef } from "react";

type InfiniteScrollSentinelProps = {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    onLoadMore: () => void;
};

/**
 * 一覧の末尾に置き、表示領域へ入ったら次のページを読み込む。
 * 「続きを読む」ボタンの代わりに使う。
 */
export function InfiniteScrollSentinel({
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
}: InfiniteScrollSentinelProps) {
    const sentinelRef = useRef<HTMLOutputElement>(null);
    // 呼び出し側が毎回新しい関数を渡しても observer を作り直さない
    const loadMoreRef = useRef(onLoadMore);

    useEffect(() => {
        loadMoreRef.current = onLoadMore;
    }, [onLoadMore]);

    useEffect(() => {
        const sentinel = sentinelRef.current;

        if (!sentinel || !hasNextPage || isFetchingNextPage) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    loadMoreRef.current();
                }
            },
            // 末尾に届く手前で読み始め、スクロールを止めない
            { rootMargin: "200px" },
        );

        observer.observe(sentinel);

        return () => observer.disconnect();
    }, [hasNextPage, isFetchingNextPage]);

    if (!hasNextPage && !isFetchingNextPage) {
        return null;
    }

    return (
        // <output> は role="status" と aria-live="polite" を既定で持つ
        <output
            className="flex items-center justify-center p-4 text-sm text-muted-foreground"
            ref={sentinelRef}
        >
            {isFetchingNextPage ? "読み込み中…" : null}
        </output>
    );
}
