/**
 * `datetime-local` の入力値をローカル時刻として解釈し、ISO 8601 UTC へ変換する。
 * 期限値はロットの同一性そのものなので、品目フォームと同じ変換規則に揃える。
 * 空文字と解釈できない値は null を返す。
 */
export const toIsoDateTime = (value: string): string | null => {
    if (!value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** 既存ロットの期限を `datetime-local` の入力値へ戻す。分単位までを表示する。 */
export const toDateTimeLocalValue = (value: string | null): string => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** 入庫数量は 1 以上の整数だけを受ける（delta = 0 は API が拒否する）。 */
export const parsePositiveInteger = (value: string): number | null => {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const pad = (value: number): string => String(value).padStart(2, "0");
