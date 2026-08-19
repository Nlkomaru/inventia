/** 入庫数量は 1 以上の整数だけを受ける（delta = 0 は API が拒否する）。 */
export const parsePositiveInteger = (value: string): number | null => {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * `YYYY-MM-DD` をその日のローカル 0 時として ISO 8601 UTC へ変換する。
 * ロットの同一性は期限値そのものなので、レシート取込が日付を 0 時へ寄せるのと
 * 同じ規則にして、手入力とレシート反映が同じロットへ入るようにする。
 * 空文字と存在しない日付は null を返す。
 */
export const toIsoFromDate = (value: string): string | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    // 2 月 30 日のような日付は Date が繰り上げるため、往復させて弾く
    return toDateInputValue(date.toISOString()) === value
        ? date.toISOString()
        : null;
};

/** 保存済みの期限を `YYYY-MM-DD` へ戻す。時刻はローカルの日付へ丸める。 */
export const toDateInputValue = (value: string | null): string => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
