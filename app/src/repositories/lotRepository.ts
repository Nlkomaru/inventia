export interface ItemLotRow {
    id: string;
    itemId: string;
    expiryDate: string | null;
    quantity: number;
    createdAt: string;
    updatedAt: string;
}

export interface ItemLotListOptions {
    // 数量 0 のロットは allocation の参照先として残るため、既定では返さない
    includeEmpty: boolean;
}

export class LotExpiryConflictError extends Error {
    constructor() {
        super("lots were updated concurrently");
        this.name = "LotExpiryConflictError";
    }
}

const lotColumns = `id,
        item_id AS itemId,
        expiry_date AS expiryDate,
        quantity,
        created_at AS createdAt,
        updated_at AS updatedAt`;

// FEFO 順（期限昇順・期限なし最後・同期限は id 昇順）で並びを一意に安定させる
const fefoOrder = "ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC, id ASC";

// D1 の bind 上限（100）より小さく保つ。items 側の getItemsByIds と同じ値
const listItemLotsChunkSize = 90;

const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const isUniqueViolation = (error: unknown): boolean =>
    errorMessage(error).toLowerCase().includes("unique constraint failed");

export const listItemLots = async (
    db: D1Database,
    itemId: string,
    options: ItemLotListOptions,
): Promise<ItemLotRow[]> => {
    const result = await db
        .prepare(
            `SELECT ${lotColumns}
             FROM item_lots
             WHERE item_id = ?${options.includeEmpty ? "" : " AND quantity > 0"}
             ${fefoOrder}`,
        )
        .bind(itemId)
        .all<ItemLotRow>();
    return result.results;
};

/**
 * 複数の品目のロットを IN 句 1 回で引く。品目ごとに問い合わせない用途のためにあり、
 * プレースホルダ数は D1 の bind 上限に収まるようチャンクへ分ける。
 * 返す Map は品目 id ごとに `listItemLots` と同じ FEFO 順を保つ。
 */
export const listItemLotsByItemIds = async (
    db: D1Database,
    itemIds: readonly string[],
    options: ItemLotListOptions,
): Promise<Map<string, ItemLotRow[]>> => {
    const byItemId = new Map<string, ItemLotRow[]>();
    if (itemIds.length === 0) {
        return byItemId;
    }
    const chunks: string[][] = [];
    for (
        let offset = 0;
        offset < itemIds.length;
        offset += listItemLotsChunkSize
    ) {
        chunks.push([...itemIds].slice(offset, offset + listItemLotsChunkSize));
    }
    const results = await Promise.all(
        chunks.map((chunk) => {
            const placeholders = chunk.map(() => "?").join(", ");
            return db
                .prepare(
                    `SELECT ${lotColumns}
             FROM item_lots
             WHERE item_id IN (${placeholders})${options.includeEmpty ? "" : " AND quantity > 0"}
             ${fefoOrder}`,
                )
                .bind(...chunk)
                .all<ItemLotRow>();
        }),
    );
    for (const result of results) {
        for (const row of result.results) {
            const existing = byItemId.get(row.itemId);
            if (existing) {
                existing.push(row);
            } else {
                byItemId.set(row.itemId, [row]);
            }
        }
    }
    return byItemId;
};

export const getItemLot = async (
    db: D1Database,
    itemId: string,
    lotId: string,
): Promise<ItemLotRow | null> =>
    db
        .prepare(
            `SELECT ${lotColumns}
             FROM item_lots
             WHERE id = ? AND item_id = ?`,
        )
        .bind(lotId, itemId)
        .first<ItemLotRow>();

/**
 * ロットの期限を変更する。同じ期限のロットが既にある場合は数量を合算し、移動元は数量 0 で残す。
 * 合計数量は変わらないため items と stock_movements には触れない。
 *
 * マージ先は batch の外で期限から解決するため、batch 内の各 statement は移動元と
 * マージ先の期限を条件に含め、解決した時点の期限のままであることを再確認する。
 * どちらかの期限が同時に変わっていた場合は両 statement が 0 件になり（どちらも
 * 相手側の期限を EXISTS で確認する）、利用者が指定していない期限のロットへ数量が
 * 移ることはない。マージは movement を残さないため、履歴から追えない移動を作らない。
 */
export const updateLotExpiryDate = async (
    db: D1Database,
    itemId: string,
    lot: ItemLotRow,
    expiryDate: string | null,
): Promise<void> => {
    const now = new Date().toISOString();
    const target = await db
        .prepare(
            `SELECT id FROM item_lots
             WHERE item_id = ? AND expiry_date IS ? AND id <> ?`,
        )
        .bind(itemId, expiryDate, lot.id)
        .first<{ id: string }>();
    const statements: D1PreparedStatement[] = target
        ? [
              // 合算元の数量はサブクエリで読む。アプリ側の読み取り値で上書きしないため、
              // 同時更新で数量を失わない
              db
                  .prepare(
                      `UPDATE item_lots
                       SET quantity = quantity + (
                               SELECT quantity FROM item_lots WHERE id = ?
                           ),
                           updated_at = ?
                       WHERE id = ? AND item_id = ? AND expiry_date IS ?
                         AND EXISTS (
                               SELECT 1 FROM item_lots source
                               WHERE source.id = ? AND source.item_id = ?
                                 AND source.expiry_date IS ?
                           )`,
                  )
                  .bind(
                      lot.id,
                      now,
                      target.id,
                      itemId,
                      expiryDate,
                      lot.id,
                      itemId,
                      lot.expiryDate,
                  ),
              db
                  .prepare(
                      `UPDATE item_lots
                       SET quantity = 0, updated_at = ?
                       WHERE id = ? AND item_id = ? AND expiry_date IS ?
                         AND EXISTS (
                               SELECT 1 FROM item_lots merged
                               WHERE merged.id = ? AND merged.item_id = ?
                                 AND merged.expiry_date IS ?
                           )`,
                  )
                  .bind(
                      now,
                      lot.id,
                      itemId,
                      lot.expiryDate,
                      target.id,
                      itemId,
                      expiryDate,
                  ),
          ]
        : [
              db
                  .prepare(
                      `UPDATE item_lots
                       SET expiry_date = ?, updated_at = ?
                       WHERE id = ? AND item_id = ? AND expiry_date IS ?`,
                  )
                  .bind(expiryDate, now, lot.id, itemId, lot.expiryDate),
          ];
    const results = await db.batch(statements).catch((error: unknown) => {
        // 期限変更の直前に同じ期限のロットが作られた場合は unique index で失敗する
        if (isUniqueViolation(error)) {
            throw new LotExpiryConflictError();
        }
        throw error;
    });
    // 0 件は同時更新で前提が崩れたことを意味する。マージの 2 statement は同じ条件を
    // 見るため、片方だけが適用されることはない
    if (results.some((result) => result.meta.changes === 0)) {
        throw new LotExpiryConflictError();
    }
};
