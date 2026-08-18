import type { ReceiptStatus } from "@/domain/receipt";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/datetime";

export const receiptStatusLabels: Record<ReceiptStatus, string> = {
    uploaded: "アップロード済み",
    parsing: "解析中",
    parsed: "解析済み・未反映",
    applied: "反映済み",
    failed: "解析失敗",
};

// 状態バッジの配色。反映済みだけを肯定色にし、失敗は destructive で示す
export const receiptStatusClassNames: Record<ReceiptStatus, string> = {
    uploaded: "border-border bg-muted text-muted-foreground",
    parsing: "border-border bg-muted text-muted-foreground",
    parsed: "border-primary/30 bg-primary/10 text-primary",
    applied:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    failed: "border-destructive/30 bg-destructive/10 text-destructive",
};

/** 金額は円の整数。0 円も「¥0」と出す（未入力の「—」と区別する）。 */
export const formatYen = (value: number | null): string =>
    value === null ? "—" : `¥${value.toLocaleString("ja-JP")}`;

export const formatDateTimeOrDash = (value: string | null): string =>
    value === null ? "—" : (formatDisplayDateTime(value) ?? value);

/** 期限は日付のみ。null は「期限なし」と読める文言にする。 */
export const formatExpiryDate = (value: string | null): string =>
    value === null
        ? "期限なし"
        : (formatDisplayDate(`${value}T00:00:00.000Z`) ?? value);
