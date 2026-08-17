import { z } from "zod";

// item_reading_states.status と同じ値。domain は drizzle に依存しないため
// db/schema.ts の readingStatuses とは別に定義する（stockMovementReasons と同じ扱い）
export const readingStatuses = ["unread", "reading", "finished"] as const;

export const readingStatusSchema = z.enum(readingStatuses);

const normalizeUtcDateTime = (value: string): string =>
    new Date(value).toISOString();

// 入力の日時は保存・API とも ISO 8601 UTC へ正規化する。
// DB の ck_item_reading_states_date_order は辞書順比較で前後関係を判定するため、
// 固定書式に揃える必要がある
export const readingDateSchema = z.iso
    .datetime({ offset: true })
    .transform(normalizeUtcDateTime)
    .nullable();

// 出力 DTO は保存済みの正規化値を返すため transform を持たない。
// transform を含むスキーマは JSON Schema へ変換できず、MCP の outputSchema に使うと
// tools/list 全体が失敗するため、出力側は書式の検証だけを行う
export const readingDateOutputSchema = z.string().datetime().nullable();

export const readingStateDtoSchema = z
    .object({
        itemId: z.string().min(1),
        status: readingStatusSchema,
        startedAt: readingDateOutputSchema,
        finishedAt: readingDateOutputSchema,
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

// upsert は全置換であり、省略した日時は null として保存する。
// 状態だけを変えて日時を残すと、残った日時が新しい状態と矛盾し得るため部分更新にしない
export const readingStateUpsertSchema = z
    .object({
        status: readingStatusSchema,
        startedAt: readingDateSchema.optional(),
        finishedAt: readingDateSchema.optional(),
    })
    .strict();

// 書籍カテゴリーの品目と読書状態の一覧入力。status を指定した場合は
// その状態が保存されている品目だけに絞る
export const bookReadingListQuerySchema = z
    .object({
        status: readingStatusSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).optional(),
    })
    .strict();

/** 保存済みの読書状態。repository の行と DTO で同じ形を共有する。 */
export interface ReadingStateSnapshot {
    itemId: string;
    status: ReadingStatus;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export const toReadingStateDto = (
    state: ReadingStateSnapshot,
): ReadingStateDto => ({
    itemId: state.itemId,
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
});

export type ReadingStateValidation =
    | { valid: true }
    | { valid: false; message: string };

/**
 * 状態と日時の矛盾を検証する。DB の `ck_item_reading_states_*` と同じ規則を
 * ドメインにも持つのは、制約違反の内部例外ではなく利用者が直せるエラーを返すためである。
 *
 * 日時は正規化済み ISO 8601 UTC を前提に辞書順で比較し、CHECK と同じ判定にする。
 * `status = 'finished'` で日時が無い場合は規則が無く、DB と同じく受け付ける。
 */
export const validateReadingState = (state: {
    status: ReadingStatus;
    startedAt: string | null;
    finishedAt: string | null;
}): ReadingStateValidation => {
    if (
        state.status === "unread" &&
        (state.startedAt !== null || state.finishedAt !== null)
    ) {
        return {
            valid: false,
            message:
                "startedAt and finishedAt must be empty when status is unread",
        };
    }
    if (state.status === "reading" && state.finishedAt !== null) {
        return {
            valid: false,
            message: "finishedAt must be empty when status is reading",
        };
    }
    if (
        state.startedAt !== null &&
        state.finishedAt !== null &&
        state.finishedAt < state.startedAt
    ) {
        return {
            valid: false,
            message: "finishedAt must not be earlier than startedAt",
        };
    }
    return { valid: true };
};

export type ReadingStatus = z.infer<typeof readingStatusSchema>;
export type ReadingStateDto = z.infer<typeof readingStateDtoSchema>;
export type ReadingStateUpsertInput = z.infer<typeof readingStateUpsertSchema>;
export type BookReadingListQuery = z.infer<typeof bookReadingListQuerySchema>;
