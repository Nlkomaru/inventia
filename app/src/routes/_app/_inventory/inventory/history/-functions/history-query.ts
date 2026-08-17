/** 履歴一覧の絞り込みと cursor。null は「絞り込まない」を意味する。 */
export interface HistoryQuery {
    itemId: string | null;
    reason: string | null;
    cursor: string | null;
    limit: number;
}

/**
 * 履歴取得の query string を作る。
 * 未指定の絞り込みは送らない（空文字を送ると API の検証で 400 になる）。
 */
export const toHistoryParams = (query: HistoryQuery): string => {
    const params = new URLSearchParams({ limit: String(query.limit) });
    if (query.itemId) params.set("itemId", query.itemId);
    if (query.reason) params.set("reason", query.reason);
    if (query.cursor) params.set("cursor", query.cursor);
    return params.toString();
};

/** 増減を符号付きで表示する。0 は期限別の内訳だけが変わった棚卸しで現れる。 */
export const formatDelta = (delta: number): string =>
    delta > 0 ? `+${delta}` : String(delta);
