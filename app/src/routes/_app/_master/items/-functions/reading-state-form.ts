import {
    type ReadingStateDto,
    type ReadingStateUpsertInput,
    type ReadingStatus,
    readingStateUpsertSchema,
    validateReadingState,
} from "@/domain/reading";

// 表示用のラベル。ReadingStatus を鍵にして、状態が増えたときに漏れを型で気づけるようにする
export const readingStatusLabels: Record<ReadingStatus, string> = {
    unread: "未読",
    reading: "読書中",
    finished: "読了",
};

/**
 * 読書状態欄の入力値。未設定は空文字で表し、日付は `type="date"` の `YYYY-MM-DD`。
 */
export interface ReadingStateFormValues {
    readingStatus: ReadingStatus | "";
    readingStartedAt: string;
    readingFinishedAt: string;
}

export type ReadingStateFormField = keyof ReadingStateFormValues;

/** 保存時に読書状態へ行う操作。`unchanged` はリクエストを送らない。 */
export type ReadingStateChange =
    | { kind: "unchanged" }
    | { kind: "clear" }
    | { kind: "set"; input: ReadingStateUpsertInput };

export type ReadingStateResolution =
    | { ok: true; change: ReadingStateChange }
    | { ok: false; field: ReadingStateFormField; message: string };

interface ReadingStateCandidate {
    status: ReadingStatus;
    startedAt: string | null;
    finishedAt: string | null;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 日付入力を保存値へ変換する。入力は UTC の暦日として扱う。
 * ローカル時刻の 0 時へ寄せると保存値と表示が 1 日ずれ、再表示のたびに日付が動く。
 */
export const toReadingDateIso = (value: string): string | null => {
    if (!datePattern.test(value)) return null;
    const iso = `${value}T00:00:00.000Z`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    // 2026-02-31 のような存在しない日付を弾く
    return date.toISOString() === iso ? iso : null;
};

/** 保存値を日付入力へ戻す。時刻は入力欄が持てないため落とす。 */
export const toReadingDateInput = (value: string | null): string => {
    if (value === null) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

export const readingStateFormValues = (
    state: ReadingStateDto | null,
): ReadingStateFormValues =>
    state === null
        ? { readingStatus: "", readingStartedAt: "", readingFinishedAt: "" }
        : {
              readingStatus: state.status,
              readingStartedAt: toReadingDateInput(state.startedAt),
              readingFinishedAt: toReadingDateInput(state.finishedAt),
          };

// 違反したかどうかの判定は domain の validateReadingState が正。
// ここでは違反時にどの入力欄へ日本語の文言を出すかだけを決め、
// どの項目にも当てはまらない場合は domain の文言をそのまま見せる
const ruleHints: readonly {
    field: ReadingStateFormField;
    message: string;
    applies: (candidate: ReadingStateCandidate) => boolean;
}[] = [
    {
        field: "readingStartedAt",
        message: "未読の場合は開始日と読了日を空にしてください",
        applies: (candidate) =>
            candidate.status === "unread" && candidate.startedAt !== null,
    },
    {
        field: "readingFinishedAt",
        message: "未読の場合は開始日と読了日を空にしてください",
        applies: (candidate) => candidate.status === "unread",
    },
    {
        field: "readingFinishedAt",
        message: "読書中の場合は読了日を空にしてください",
        applies: (candidate) => candidate.status === "reading",
    },
    {
        field: "readingFinishedAt",
        message: "読了日は開始日より前の日付にできません",
        applies: (candidate) =>
            candidate.startedAt !== null && candidate.finishedAt !== null,
    },
];

// readingStateUpsertSchema の path を入力欄の名前へ対応させる
const issueFields: Record<string, ReadingStateFormField> = {
    status: "readingStatus",
    startedAt: "readingStartedAt",
    finishedAt: "readingFinishedAt",
};

/**
 * 入力値と保存済みの読書状態から、送るべき操作を決める。
 *
 * 日付の比較を入力欄の粒度で行うのは、MCP などが時刻付きで保存した値を
 * 触っていない編集で 0 時へ書き換えないためである。
 */
export const resolveReadingStateChange = (
    values: ReadingStateFormValues,
    current: ReadingStateDto | null,
): ReadingStateResolution => {
    if (values.readingStatus === "") {
        // 未設定の選択は、保存済みの読書状態があるときだけ削除になる
        return {
            ok: true,
            change:
                current === null ? { kind: "unchanged" } : { kind: "clear" },
        };
    }
    if (
        current !== null &&
        current.status === values.readingStatus &&
        toReadingDateInput(current.startedAt) === values.readingStartedAt &&
        toReadingDateInput(current.finishedAt) === values.readingFinishedAt
    ) {
        return { ok: true, change: { kind: "unchanged" } };
    }
    const startedAt =
        values.readingStartedAt === ""
            ? null
            : toReadingDateIso(values.readingStartedAt);
    if (startedAt === null && values.readingStartedAt !== "") {
        return {
            ok: false,
            field: "readingStartedAt",
            message: "開始日を正しく入力してください",
        };
    }
    const finishedAt =
        values.readingFinishedAt === ""
            ? null
            : toReadingDateIso(values.readingFinishedAt);
    if (finishedAt === null && values.readingFinishedAt !== "") {
        return {
            ok: false,
            field: "readingFinishedAt",
            message: "読了日を正しく入力してください",
        };
    }
    const candidate: ReadingStateCandidate = {
        status: values.readingStatus,
        startedAt,
        finishedAt,
    };
    const validation = validateReadingState(candidate);
    if (!validation.valid) {
        const hint = ruleHints.find((rule) => rule.applies(candidate));
        return hint
            ? { ok: false, field: hint.field, message: hint.message }
            : {
                  ok: false,
                  field: "readingStatus",
                  message: validation.message,
              };
    }
    const parsed = readingStateUpsertSchema.safeParse(candidate);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path[0];
        return {
            ok: false,
            field:
                typeof path === "string"
                    ? (issueFields[path] ?? "readingStatus")
                    : "readingStatus",
            message: issue?.message ?? "読書状態を確認してください",
        };
    }
    return { ok: true, change: { kind: "set", input: parsed.data } };
};
