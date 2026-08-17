/** 送信前プレビュー 1 行。`delta` は負値で、実際に引かれる数量を表す。 */
export interface IssuePlanRow {
    lotId: string;
    expiryDate: string | null;
    delta: number;
}

/** プレビューの結果。`shortage` が残る計画は送信させない。 */
export type IssuePlan =
    | { status: "ready"; rows: IssuePlanRow[] }
    | { status: "shortage"; rows: IssuePlanRow[]; shortage: number };

/** FEFO 配分に必要な最小のロット情報（`@/domain/lot` の LotSnapshot と同形）。 */
export interface IssuePlanLot {
    id: string;
    expiryDate: string | null;
    quantity: number;
}

/**
 * `allocateFefo` の結果をプレビュー用の計画へ写す。
 * 不足量が残る場合は在庫不足として扱い、送信を止める判断に使う。
 */
export const toIssuePlan = (
    allocations: readonly IssuePlanRow[],
    shortage: number,
): IssuePlan =>
    shortage > 0
        ? { status: "shortage", rows: [...allocations], shortage }
        : { status: "ready", rows: [...allocations] };

/**
 * ロットを指定した出庫の計画を作る。
 * 指定ロットが見つからない場合は全量を不足として扱う（一覧の再読み込みで解消する）。
 */
export const planLotIssue = (
    lot: IssuePlanLot | null,
    quantity: number,
): IssuePlan => {
    if (quantity <= 0) {
        return { status: "ready", rows: [] };
    }
    if (lot === null) {
        return { status: "shortage", rows: [], shortage: quantity };
    }
    const taken = Math.min(lot.quantity, quantity);
    const rows: IssuePlanRow[] =
        taken > 0
            ? [{ lotId: lot.id, expiryDate: lot.expiryDate, delta: -taken }]
            : [];
    return quantity > lot.quantity
        ? { status: "shortage", rows, shortage: quantity - lot.quantity }
        : { status: "ready", rows };
};

/** 出庫数量は 1 以上の整数だけを受ける（delta = 0 は API が拒否する）。 */
export const parsePositiveInteger = (value: string): number | null => {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};
