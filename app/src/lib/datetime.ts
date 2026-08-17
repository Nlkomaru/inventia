// 日時は ISO 8601 UTC で保存・受け渡しし、表示だけ日本時間へ変換する。
// timeZone を省略すると実行環境の時間帯（Workers は UTC）で整形されるため、
// SSR とブラウザで文字列がずれて hydration が一致しなくなる。
const displayTimeZone = "Asia/Tokyo";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeZone: displayTimeZone,
});

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: displayTimeZone,
});

/** ISO 文字列を日本時間の年月日へ整形する。解釈できない値は null を返す。 */
export const formatDisplayDate = (value: string): string | null => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
};

/** ISO 文字列を日本時間の年月日と時刻へ整形する。解釈できない値は null を返す。 */
export const formatDisplayDateTime = (value: string): string | null => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : dateTimeFormatter.format(date);
};
