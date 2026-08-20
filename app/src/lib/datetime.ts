// 日時は ISO 8601 UTC で保存・受け渡しし、表示だけ日本時間へ変換する。
// timeZone を省略すると実行環境の時間帯（Workers は UTC）で整形されるため、
// SSR とブラウザで文字列がずれて hydration が一致しなくなる。
const displayTimeZone = "Asia/Tokyo";

// 表示は入力欄と同じ 2020-01-01 の書式に揃える。ロケール既定の整形だと
// 区切りや桁が環境で変わるため、部品を取り出して自分で組み立てる
const dateParts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: displayTimeZone,
});

const timeParts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: displayTimeZone,
});

// 価格一覧の日時列は月名と 12 時間制で見せる。ロケール既定の整形は区切りや
// 「AM」の前後の空白が環境で変わるため、ここでも部品を取り出して自分で組み立てる
const monthDayParts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: displayTimeZone,
});

const hour12Parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: displayTimeZone,
});

/** ISO 文字列を日本時間の `YYYY-MM-DD` へ整形する。解釈できない値は null を返す。 */
export const formatDisplayDate = (value: string): string | null => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : dateParts.format(date);
};

/** ISO 文字列を日本時間の `YYYY-MM-DD HH:mm` へ整形する。解釈できない値は null を返す。 */
export const formatDisplayDateTime = (value: string): string | null => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return `${dateParts.format(date)} ${timeParts.format(date)}`;
};

/**
 * ISO 文字列を日本時間の `MMM DD, HH:mm AM` へ整形する（例: `Aug 21, 09:30 AM`）。
 * 解釈できない値は null を返す。
 */
export const formatDisplayMonthDayTime = (value: string): string | null => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    // en-US の 2-digit hour は「09:30 AM」を狭い空白（U+202F）で区切ることがあり、
    // 検索や比較で見えない差になるため通常の空白へ均す
    const time = hour12Parts.format(date).replace(/\s/gu, " ");
    return `${monthDayParts.format(date)}, ${time}`;
};
