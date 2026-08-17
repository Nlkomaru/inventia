import type { ReadingStateSnapshot, ReadingStatus } from "../domain/reading";

/** `item_reading_states` の 1 行。公開モデルと同じ形のため domain 型を使う。 */
export type ReadingStateRow = ReadingStateSnapshot;

/** 保存する読書状態。`created_at` / `updated_at` は repository が付ける。 */
export interface ReadingStateWrite {
    itemId: string;
    status: ReadingStatus;
    startedAt: string | null;
    finishedAt: string | null;
}

const readingStateColumns = `item_id AS itemId,
        status,
        started_at AS startedAt,
        finished_at AS finishedAt,
        created_at AS createdAt,
        updated_at AS updatedAt`;

export const getReadingState = async (
    db: D1Database,
    itemId: string,
): Promise<ReadingStateRow | null> =>
    db
        .prepare(
            `SELECT ${readingStateColumns}
             FROM item_reading_states
             WHERE item_id = ?`,
        )
        .bind(itemId)
        .first<ReadingStateRow>();

/**
 * 一覧に並んだ品目の読書状態を IN 句 1 回で解決する（N+1 禁止）。
 * bind するのは品目 id だけにし、1 クエリの bind 数を一覧の limit に収める。
 */
export const listReadingStatesByItemIds = async (
    db: D1Database,
    itemIds: readonly string[],
): Promise<Map<string, ReadingStateRow>> => {
    if (itemIds.length === 0) {
        return new Map();
    }
    const placeholders = itemIds.map(() => "?").join(", ");
    const result = await db
        .prepare(
            `SELECT ${readingStateColumns}
             FROM item_reading_states
             WHERE item_id IN (${placeholders})`,
        )
        .bind(...itemIds)
        .all<ReadingStateRow>();
    return new Map(result.results.map((row) => [row.itemId, row]));
};

/**
 * 読書状態を upsert する。日時は全置換で書き込み、`created_at` は初回の値を保つ。
 * 状態と日時の矛盾は DB の CHECK でも禁止されているため、service で検証済みの値だけを渡す。
 */
export const upsertReadingState = async (
    db: D1Database,
    state: ReadingStateWrite,
): Promise<ReadingStateRow> => {
    const now = new Date().toISOString();
    await db
        .prepare(
            `INSERT INTO item_reading_states
                    (item_id, status, started_at, finished_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(item_id) DO UPDATE SET
                    status = excluded.status,
                    started_at = excluded.started_at,
                    finished_at = excluded.finished_at,
                    updated_at = excluded.updated_at`,
        )
        .bind(
            state.itemId,
            state.status,
            state.startedAt,
            state.finishedAt,
            now,
            now,
        )
        .run();
    const saved = await getReadingState(db, state.itemId);
    if (!saved) {
        throw new Error("saved reading state could not be read");
    }
    return saved;
};

/** 読書状態を削除する。行が無ければ false を返す（在庫には影響しない）。 */
export const deleteReadingState = async (
    db: D1Database,
    itemId: string,
): Promise<boolean> => {
    const result = await db
        .prepare("DELETE FROM item_reading_states WHERE item_id = ?")
        .bind(itemId)
        .run();
    return (result.meta.changes ?? 0) > 0;
};
