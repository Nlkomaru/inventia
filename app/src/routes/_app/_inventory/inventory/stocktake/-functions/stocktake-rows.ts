/** 棚卸しフォームの 1 行。 */
export interface StocktakeRowInput {
    key: string;
    // 既存ロットは取得した ISO 8601 文字列をそのまま持つ。
    // 期限値がロットの同一性そのものなので、入力欄を経由して丸め直さない
    expiryDate: string | null;
    // 新しい期限を追加した行の datetime-local 入力値。既存ロットの行は null。
    // 空文字は期限なしロットを意味する
    expiryInput: string | null;
    quantity: string;
}

export interface StocktakeRowIssue {
    key: string;
    field: "expiry" | "quantity";
    message: string;
}

export interface StocktakeLotEntry {
    expiryDate: string | null;
    quantity: number;
}

export type StocktakeLotsResult =
    | { ok: true; lots: StocktakeLotEntry[]; total: number }
    | { ok: false; issues: StocktakeRowIssue[] };

/**
 * 入力行を棚卸しリクエストの `lots` へ変換する。
 * 同じ期限の行が重複していると API が 400 を返すため、送信前に行単位で検出する。
 * 行が 1 つもない場合は「期限なしロットを 0」だけを送る。リクエストは 1 件以上の
 * 指定を必要とし、指定に現れない既存ロットは 0 になるため、これで全ロットが 0 になる。
 */
export const buildStocktakeLots = (
    rows: readonly StocktakeRowInput[],
): StocktakeLotsResult => {
    const issues: StocktakeRowIssue[] = [];
    const lots: StocktakeLotEntry[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        const expiryDate = resolveExpiryDate(row);
        if (expiryDate === invalidExpiry) {
            issues.push({
                key: row.key,
                field: "expiry",
                message: "期限日時を正しく入力してください",
            });
            continue;
        }
        const quantity = parseNonNegativeInteger(row.quantity);
        if (quantity === null) {
            issues.push({
                key: row.key,
                field: "quantity",
                message: "0以上の整数で入力してください",
            });
            continue;
        }
        const key = expiryDate ?? "";
        if (seen.has(key)) {
            issues.push({
                key: row.key,
                field: "expiry",
                message: "同じ期限の行が複数あります。1行にまとめてください",
            });
            continue;
        }
        seen.add(key);
        lots.push({ expiryDate, quantity });
    }
    if (issues.length > 0) {
        return { ok: false, issues };
    }
    if (lots.length === 0) {
        return {
            ok: true,
            lots: [{ expiryDate: null, quantity: 0 }],
            total: 0,
        };
    }
    return {
        ok: true,
        lots,
        total: lots.reduce((total, lot) => total + lot.quantity, 0),
    };
};

// 棚卸しの絶対数量は 0 以上の整数だけを受ける（0 は在庫を空にする指定）
const parseNonNegativeInteger = (value: string): number | null => {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

// 期限として解釈できなかったことを null（期限なし）と区別する番兵
const invalidExpiry = Symbol("invalid-expiry");

const resolveExpiryDate = (
    row: StocktakeRowInput,
): string | null | typeof invalidExpiry => {
    if (row.expiryInput === null) {
        return row.expiryDate;
    }
    if (!row.expiryInput.trim()) {
        return null;
    }
    const date = new Date(row.expiryInput);
    return Number.isNaN(date.getTime()) ? invalidExpiry : date.toISOString();
};
