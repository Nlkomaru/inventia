import { newId } from "../domain/id";
import type {
    ItemCreateInput,
    ItemListQuery,
    ItemUpdateInput,
} from "../domain/item";
import type { BookReadingListQuery } from "../domain/reading";

export interface ItemRow {
    id: string;
    name: string;
    categoryId: string;
    locationId: string;
    baseUnit: string;
    baseDimension: "mass" | "volume" | "count";
    currentQuantity: number;
    // 数量 > 0 のロットのうち最も早い期限。期限付きの在庫がなければ null
    earliestExpiryDate: string | null;
    // 数量 > 0 のロット件数
    lotCount: number;
    lowStockThreshold: number | null;
    memo: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ItemListResult {
    items: ItemRow[];
    nextCursor: string | null;
}

export interface ResolvedItemCreateInput
    extends Omit<
        ItemCreateInput,
        "baseUnit" | "baseDimension" | "currentQuantity"
    > {
    baseUnit: string;
    baseDimension: "mass" | "volume" | "count";
    currentQuantity: number;
}

export class InvalidItemCursorError extends Error {
    constructor() {
        super("invalid cursor");
        this.name = "InvalidItemCursorError";
    }
}

// 並び順ごとにキーが違うため cursor も分ける。`sort` を持たない cursor は
// 名前順しか存在しなかった頃に発行したものとして受け、期限順の要求には使わせない
// （並び順の違う cursor を流用すると位置がずれたページを返す）
type NameCursor = { sort?: "name"; name: string; id: string };
type ExpiryCursor = { sort: "expiry"; expiry: string | null; id: string };
type Cursor = NameCursor | ExpiryCursor;

const encodeCursor = (cursor: Cursor): string =>
    btoa(encodeURIComponent(JSON.stringify(cursor)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");

const isNameCursor = (value: Record<string, unknown>): boolean =>
    (value.sort === undefined || value.sort === "name") &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.id === "string" &&
    value.id.length > 0;

const isExpiryCursor = (value: Record<string, unknown>): boolean =>
    value.sort === "expiry" &&
    (value.expiry === null || typeof value.expiry === "string") &&
    typeof value.id === "string" &&
    (value.id as string).length > 0;

const decodeCursor = (value: string, sort: "name" | "expiry"): Cursor => {
    try {
        const padded = value.replaceAll("-", "+").replaceAll("_", "/");
        const decoded = decodeURIComponent(atob(padded));
        const parsed: unknown = JSON.parse(decoded);
        if (typeof parsed !== "object" || parsed === null) {
            throw new Error("invalid cursor");
        }
        const record = parsed as Record<string, unknown>;
        if (sort === "name" ? !isNameCursor(record) : !isExpiryCursor(record)) {
            throw new Error("invalid cursor");
        }
        return parsed as Cursor;
    } catch {
        throw new InvalidItemCursorError();
    }
};

const escapeLike = (value: string): string =>
    value
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_");

const dayInMilliseconds = 24 * 60 * 60 * 1000;

// 期限集計は items の SELECT 内の相関サブクエリで求め、ロットの追加読みで N+1 を作らない。
// uq_item_lots_item_expiry を item_id の前方一致で使える。
// 数量 0 のロットは既定の表示対象外なので集計から除く。
// 品目を返す他 repository の query（棚卸しが古い品目の一覧など）が同じ射影を
// 重複定義しないよう export する。相関サブクエリは items を明示参照するため、
// items へ別名を付けない query で使うこと
export const itemColumns = `id, name, category_id AS categoryId, location_id AS locationId,
		base_unit AS baseUnit, base_dimension AS baseDimension,
		current_quantity AS currentQuantity,
		(SELECT MIN(expiry_date) FROM item_lots
			WHERE item_id = items.id AND quantity > 0 AND expiry_date IS NOT NULL)
			AS earliestExpiryDate,
		(SELECT COUNT(*) FROM item_lots
			WHERE item_id = items.id AND quantity > 0) AS lotCount,
		low_stock_threshold AS lowStockThreshold, memo,
		created_at AS createdAt, updated_at AS updatedAt`;

// 期限順の並び替えと keyset 条件で使う式。`itemColumns` の earliestExpiryDate と
// 同じ定義で、SELECT の別名は WHERE では参照できないため式を再掲する
const earliestExpiryExpression = `(SELECT MIN(expiry_date) FROM item_lots
		WHERE item_id = items.id AND quantity > 0 AND expiry_date IS NOT NULL)`;

// 期限が早い順。期限なしは最後に置き、同じ期限は id で一意に安定させる
const expiryOrder = `ORDER BY (${earliestExpiryExpression} IS NULL) ASC,
		${earliestExpiryExpression} ASC, id ASC`;

// 読書状態は品目と 1:1 の別テーブルにあるため EXISTS で絞る。
// 行が無い品目はどの状態にも一致しない
const readingStatusCondition = `EXISTS (SELECT 1 FROM item_reading_states
        WHERE item_id = items.id AND status = ?)`;

// 実効カテゴリー種別が book の品目を選ぶための CTE。kind が NULL の子カテゴリーは
// 直近の非 NULL 祖先の種別を継承するため、kind IS NULL の子だけを辿る
// （getCategoryKind の祖先解決と同じ規則）
const bookCategoriesCte = `WITH RECURSIVE book_categories(id) AS (
		SELECT id FROM categories WHERE kind = 'book'
		UNION
		SELECT categories.id FROM categories
			JOIN book_categories ON categories.parent_id = book_categories.id
			WHERE categories.kind IS NULL
	)`;

export const getItem = async (
    db: D1Database,
    id: string,
): Promise<ItemRow | null> =>
    db
        .prepare(`SELECT ${itemColumns} FROM items WHERE id = ?`)
        .bind(id)
        .first<ItemRow>();

// D1 の 1 クエリあたりのバインドパラメータ上限は 100。IN 句だけでちょうど使い切ると
// 呼び出し元が絞り込み条件を 1 つ足しただけで壊れるため、余裕を残したチャンク単位に
// 分割してクエリを結合する
const getItemsByIdsChunkSize = 90;

/**
 * ID の配列でまとめて品目行を引く。IN 句のプレースホルダ数はチャンクサイズ以下に
 * 保たれ、値は必ず bind して ID を SQL 文字列へ連結しない。結果順は DB 依存で不定な
 * ため、呼び出し元が希望の順序（例: ベクトル検索の類似度順）へ並べ直すこと。
 */
export const getItemsByIds = async (
    db: D1Database,
    ids: readonly string[],
): Promise<ItemRow[]> => {
    if (ids.length === 0) {
        return [];
    }
    const chunks: string[][] = [];
    for (
        let offset = 0;
        offset < ids.length;
        offset += getItemsByIdsChunkSize
    ) {
        chunks.push(ids.slice(offset, offset + getItemsByIdsChunkSize));
    }
    const results = await Promise.all(
        chunks.map((chunk) => {
            const placeholders = chunk.map(() => "?").join(", ");
            return db
                .prepare(
                    `SELECT ${itemColumns} FROM items WHERE id IN (${placeholders})`,
                )
                .bind(...chunk)
                .all<ItemRow>();
        }),
    );
    return results.flatMap((result) => result.results);
};

export const listItems = async (
    db: D1Database,
    query: ItemListQuery,
): Promise<ItemListResult> => {
    const where: string[] = [];
    const bindings: unknown[] = [];

    if (query.q) {
        where.push("name LIKE ? ESCAPE char(92) COLLATE NOCASE");
        bindings.push(`%${escapeLike(query.q)}%`);
    }
    if (query.categoryId) {
        where.push("category_id = ?");
        bindings.push(query.categoryId);
    }
    if (query.locationId) {
        where.push("location_id = ?");
        bindings.push(query.locationId);
    }
    if (query.lowStockOnly) {
        where.push(
            "low_stock_threshold IS NOT NULL AND current_quantity <= low_stock_threshold",
        );
    }
    if (query.expiringWithinDays !== undefined) {
        // 期限なしロットは対象外。既に期限を過ぎたロットは常に該当する
        where.push(
            `EXISTS (SELECT 1 FROM item_lots
				WHERE item_id = items.id AND quantity > 0
					AND expiry_date IS NOT NULL AND expiry_date <= ?)`,
        );
        bindings.push(
            new Date(
                Date.now() + query.expiringWithinDays * dayInMilliseconds,
            ).toISOString(),
        );
    }
    if (query.readingStatus) {
        where.push(readingStatusCondition);
        bindings.push(query.readingStatus);
    }
    if (query.cursor) {
        const cursor = decodeCursor(query.cursor, query.sort);
        if ("expiry" in cursor) {
            // 期限なしのグループは末尾にあるため、そこから先は id だけで進む
            if (cursor.expiry === null) {
                where.push(`${earliestExpiryExpression} IS NULL AND id > ?`);
                bindings.push(cursor.id);
            } else {
                where.push(`(${earliestExpiryExpression} IS NULL
					OR ${earliestExpiryExpression} > ?
					OR (${earliestExpiryExpression} = ? AND id > ?))`);
                bindings.push(cursor.expiry, cursor.expiry, cursor.id);
            }
        } else {
            where.push(
                "(name COLLATE NOCASE > ? OR (name COLLATE NOCASE = ? AND id > ?))",
            );
            bindings.push(cursor.name, cursor.name, cursor.id);
        }
    }

    const limit = query.limit;
    const sql = `SELECT ${itemColumns}
		FROM items${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}
		${query.sort === "expiry" ? expiryOrder : "ORDER BY name COLLATE NOCASE ASC, id ASC"} LIMIT ?`;
    const result = await db
        .prepare(sql)
        .bind(...bindings, limit + 1)
        .all<ItemRow>();
    const rows = result.results;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
        items,
        nextCursor:
            hasMore && last
                ? encodeCursor(
                      query.sort === "expiry"
                          ? {
                                sort: "expiry",
                                expiry: last.earliestExpiryDate,
                                id: last.id,
                            }
                          : { sort: "name", name: last.name, id: last.id },
                  )
                : null,
    };
};

/**
 * 実効カテゴリー種別が book の品目を、一覧と同じ (name, id) 順で返す。
 * 読書状態はこのクエリでは読まず、返した品目 id の IN 句 1 回で解決する
 * （listReadingStatesByItemIds）。`status` を指定した場合はその状態が
 * 保存されている品目だけに絞るため、読書状態が無い書籍は含めない。
 */
export const listBookItems = async (
    db: D1Database,
    query: BookReadingListQuery,
): Promise<ItemListResult> => {
    const where: string[] = ["category_id IN (SELECT id FROM book_categories)"];
    const bindings: unknown[] = [];

    if (query.status) {
        where.push(readingStatusCondition);
        bindings.push(query.status);
    }
    if (query.cursor) {
        const cursor = decodeCursor(query.cursor, "name");
        if ("name" in cursor) {
            where.push(
                "(name COLLATE NOCASE > ? OR (name COLLATE NOCASE = ? AND id > ?))",
            );
            bindings.push(cursor.name, cursor.name, cursor.id);
        }
    }

    const limit = query.limit;
    const result = await db
        .prepare(
            `${bookCategoriesCte}
			SELECT ${itemColumns}
			FROM items WHERE ${where.join(" AND ")}
			ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT ?`,
        )
        .bind(...bindings, limit + 1)
        .all<ItemRow>();
    const rows = result.results;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
        items,
        nextCursor:
            hasMore && last
                ? encodeCursor({ name: last.name, id: last.id })
                : null,
    };
};

export const getCategoryKind = async (
    db: D1Database,
    categoryId: string,
): Promise<"daily_goods" | "food" | "book" | "document" | null> => {
    const result = await db
        .prepare(
            `WITH RECURSIVE ancestors(id, parent_id, kind, depth) AS (
					SELECT id, parent_id, kind, 0 FROM categories WHERE id = ?
					UNION ALL
					SELECT categories.id, categories.parent_id, categories.kind, ancestors.depth + 1
					FROM categories JOIN ancestors ON categories.id = ancestors.parent_id
				)
				SELECT kind FROM ancestors
				WHERE kind IS NOT NULL ORDER BY depth ASC LIMIT 1`,
        )
        .bind(categoryId)
        .first<{ kind: "daily_goods" | "food" | "book" | "document" }>();
    return result?.kind ?? null;
};

export const categoryExists = async (
    db: D1Database,
    categoryId: string,
): Promise<boolean> =>
    Boolean(
        await db
            .prepare("SELECT id FROM categories WHERE id = ? LIMIT 1")
            .bind(categoryId)
            .first<{ id: string }>(),
    );

export const locationExists = async (
    db: D1Database,
    locationId: string,
): Promise<boolean> =>
    Boolean(
        await db
            .prepare("SELECT id FROM storage_locations WHERE id = ? LIMIT 1")
            .bind(locationId)
            .first<{ id: string }>(),
    );

export interface LocationItemCountRow {
    locationId: string;
    itemCount: number;
}

/**
 * 保管場所ごとの品目件数。品目が 1 件も無い場所は行を返さないため、
 * 呼び出し側は欠けた場所を 0 件として扱うこと。子孫の合算は行わない。
 */
export const countItemsByLocation = async (
    db: D1Database,
): Promise<LocationItemCountRow[]> => {
    const result = await db
        .prepare(
            `SELECT location_id AS locationId, COUNT(*) AS itemCount
				FROM items
				GROUP BY location_id`,
        )
        .all<LocationItemCountRow>();
    return result.results;
};

/**
 * 品目を作る。`options.id` を渡すと採番済みの ID で作る。
 * 呼び出し側が作成前に ID を確定させておきたい場合（再実行で同じ品目へ収束させる
 * 場合など）にだけ使い、通常はここで採番する。
 */
export const createItem = async (
    db: D1Database,
    input: ResolvedItemCreateInput,
    options: { id?: string } = {},
): Promise<ItemRow> => {
    const id = options.id ?? newId();
    const now = new Date().toISOString();
    const expiryDate = input.expiryDate ?? null;
    const itemStatement = db
        .prepare(
            `INSERT INTO items
					(id, name, category_id, location_id, base_unit, base_dimension,
					 current_quantity, low_stock_threshold, memo, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            id,
            input.name,
            input.categoryId,
            input.locationId,
            input.baseUnit,
            input.baseDimension,
            input.currentQuantity,
            input.lowStockThreshold ?? null,
            input.memo ?? null,
            now,
            now,
        );
    const statements: D1PreparedStatement[] = [itemStatement];
    // 在庫か期限のどちらかがあるときだけ初期ロットを作る。
    // 数量 0 かつ期限なしの品目はロットを持たない
    const lotId =
        input.currentQuantity > 0 || expiryDate !== null ? newId() : null;
    if (lotId) {
        statements.push(
            db
                .prepare(
                    `INSERT INTO item_lots
							(id, item_id, expiry_date, quantity, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?)`,
                )
                .bind(lotId, id, expiryDate, input.currentQuantity, now, now),
        );
    }
    if (input.currentQuantity > 0 && lotId) {
        const movementId = newId();
        statements.push(
            db
                .prepare(
                    `INSERT INTO stock_movements
							(id, item_id, delta, reason, purchase_id, occurred_at, idempotency_key, created_at)
						 VALUES (?, ?, ?, 'stocktake', NULL, ?, NULL, ?)`,
                )
                .bind(movementId, id, input.currentQuantity, now, now),
            // 初期在庫の movement もロット内訳を持たせ、履歴の一貫性を保つ。
            // 期限は記録時点のスナップショットとして allocation に写す
            db
                .prepare(
                    `INSERT INTO stock_movement_lot_allocations
							(id, movement_id, lot_id, expiry_date, delta, created_at)
						 VALUES (?, ?, ?, ?, ?, ?)`,
                )
                .bind(
                    newId(),
                    movementId,
                    lotId,
                    expiryDate,
                    input.currentQuantity,
                    now,
                ),
        );
    }
    await db.batch(statements);
    const created = await getItem(db, id);
    if (!created) {
        throw new Error("created item could not be read");
    }
    return created;
};

export const updateItem = async (
    db: D1Database,
    id: string,
    input: ItemUpdateInput,
): Promise<ItemRow | null> => {
    const assignments: string[] = [];
    const bindings: unknown[] = [];
    const fields: Array<[keyof typeof input, string]> = [
        ["name", "name"],
        ["categoryId", "category_id"],
        ["locationId", "location_id"],
        ["lowStockThreshold", "low_stock_threshold"],
        ["memo", "memo"],
    ];
    for (const [key, column] of fields) {
        if (input[key] !== undefined) {
            assignments.push(`${column} = ?`);
            bindings.push(input[key] ?? null);
        }
    }
    if (assignments.length === 0) {
        return getItem(db, id);
    }
    assignments.push("updated_at = ?");
    bindings.push(new Date().toISOString(), id);
    await db
        .prepare(`UPDATE items SET ${assignments.join(", ")} WHERE id = ?`)
        .bind(...bindings)
        .run();
    return getItem(db, id);
};

export const deleteItem = async (
    db: D1Database,
    id: string,
): Promise<boolean> => {
    // 履歴を持たない品目を削除できる従来の挙動を保つため、allocation から
    // 参照されていない空ロットだけ先に消す。在庫や履歴が残るロットは
    // item_lots の FK restrict で items の削除自体が失敗する
    const results = await db.batch([
        // item_reading_states は ON DELETE restrict のため先に消す。読書状態は
        // 在庫履歴ではないので、これを理由に品目の削除を止めない
        db
            .prepare("DELETE FROM item_reading_states WHERE item_id = ?")
            .bind(id),
        db
            .prepare(
                `DELETE FROM item_lots
					WHERE item_id = ? AND quantity = 0
						AND NOT EXISTS (
							SELECT 1 FROM stock_movement_lot_allocations
							WHERE lot_id = item_lots.id
						)`,
            )
            .bind(id),
        db.prepare("DELETE FROM items WHERE id = ?").bind(id),
    ]);
    return (results[2]?.meta.changes ?? 0) > 0;
};
