import { newId } from "../domain/id";
import type {
    ReceiptApplyAction,
    ReceiptBaseDimension,
    ReceiptCursor,
    ReceiptExpiryConfidence,
    ReceiptExpirySource,
    ReceiptMatchMethodValue,
    ReceiptStatus,
} from "../domain/receipt";

// D1 だけを扱う。R2 と外部 API の呼び出しは service 層に置く。

export interface ReceiptRow {
    id: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
    status: ReceiptStatus;
    storeName: string | null;
    purchasedAt: string | null;
    totalPrice: number | null;
    model: string | null;
    errorMessage: string | null;
    purchaseId: string | null;
    appliedAt: string | null;
    lineCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface ReceiptLineRow {
    id: string;
    receiptId: string;
    lineNo: number;
    rawName: string;
    completedName: string | null;
    normalizedName: string;
    quantity: number;
    price: number | null;
    printedExpiryDate: string | null;
    estimatedExpiryDate: string | null;
    expirySource: ReceiptExpirySource;
    expiryConfidence: ReceiptExpiryConfidence | null;
    // 列名は expiry_reason。domain の expiryEstimateReason と対応する
    expiryReason: string | null;
    stockRelevant: boolean;
    suggestedCategoryId: string | null;
    suggestedCategoryName: string | null;
    suggestedBaseUnit: string | null;
    suggestedBaseDimension: ReceiptBaseDimension | null;
    matchedItemId: string | null;
    // create_item の反映で使う品目 ID の先行予約。品目作成より先に書く
    pendingItemId: string | null;
    matchMethod: ReceiptMatchMethodValue | null;
    matchScore: number | null;
    createdAt: string;
    updatedAt: string;
    // 反映で実際に記録された内容。解析値（quantity・price・期限）は上の列に
    // 残るため、この 6 つは「承認された事実」だけを持つ。未反映の行はすべて null
    appliedAction: ReceiptApplyAction | null;
    appliedQuantity: number | null;
    appliedBaseUnit: string | null;
    appliedPrice: number | null;
    appliedExpiryDate: string | null;
    appliedAt: string | null;
}

export interface ReceiptLineWrite {
    lineNo: number;
    rawName: string;
    completedName: string | null;
    normalizedName: string;
    quantity: number;
    price: number | null;
    printedExpiryDate: string | null;
    estimatedExpiryDate: string | null;
    expirySource: ReceiptExpirySource;
    expiryConfidence: ReceiptExpiryConfidence | null;
    expiryReason: string | null;
    stockRelevant: boolean;
    suggestedCategoryId: string | null;
    suggestedCategoryName: string | null;
    suggestedBaseUnit: string | null;
    suggestedBaseDimension: ReceiptBaseDimension | null;
}

export interface ReceiptLineMatchWrite {
    id: string;
    matchedItemId: string | null;
    matchMethod: ReceiptMatchMethodValue | null;
    matchScore: number | null;
}

export interface ReceiptListQueryRow {
    status: ReceiptStatus | null;
    limit: number;
    cursor: ReceiptCursor | null;
}

export interface ReceiptListResult {
    rows: ReceiptRow[];
    hasMore: boolean;
}

export interface MatchableItemRow {
    id: string;
    name: string;
}

export interface ItemAliasRow {
    normalizedName: string;
    itemId: string;
}

export interface ItemPricingRow {
    id: string;
    baseUnit: string;
    baseDimension: "mass" | "volume" | "count";
}

export interface PurchaseRow {
    id: string;
    source: string;
    purchasedAt: string;
    note: string | null;
    idempotencyKey: string | null;
    createdAt: string;
}

const receiptColumns = `r.id,
    r.object_key AS objectKey,
    r.content_type AS contentType,
    r.byte_size AS byteSize,
    r.status,
    r.store_name AS storeName,
    r.purchased_at AS purchasedAt,
    r.total_price AS totalPrice,
    r.model,
    r.error_message AS errorMessage,
    r.purchase_id AS purchaseId,
    r.applied_at AS appliedAt,
    (SELECT COUNT(*) FROM receipt_lines AS l WHERE l.receipt_id = r.id) AS lineCount,
    r.created_at AS createdAt,
    r.updated_at AS updatedAt`;

const receiptLineColumns = `id,
    receipt_id AS receiptId,
    line_no AS lineNo,
    raw_name AS rawName,
    completed_name AS completedName,
    normalized_name AS normalizedName,
    quantity,
    price,
    printed_expiry_date AS printedExpiryDate,
    estimated_expiry_date AS estimatedExpiryDate,
    expiry_source AS expirySource,
    expiry_confidence AS expiryConfidence,
    expiry_reason AS expiryReason,
    stock_relevant AS stockRelevant,
    suggested_category_id AS suggestedCategoryId,
    suggested_category_name AS suggestedCategoryName,
    suggested_base_unit AS suggestedBaseUnit,
    suggested_base_dimension AS suggestedBaseDimension,
    matched_item_id AS matchedItemId,
    pending_item_id AS pendingItemId,
    match_method AS matchMethod,
    match_score AS matchScore,
    created_at AS createdAt,
    updated_at AS updatedAt,
    applied_action AS appliedAction,
    applied_quantity AS appliedQuantity,
    applied_base_unit AS appliedBaseUnit,
    applied_price AS appliedPrice,
    applied_expiry_date AS appliedExpiryDate,
    applied_at AS appliedAt`;

export const findReceipt = async (
    db: D1Database,
    id: string,
): Promise<ReceiptRow | null> =>
    db
        .prepare(
            `SELECT ${receiptColumns} FROM receipts AS r WHERE r.id = ?1 LIMIT 1`,
        )
        .bind(id)
        .first<ReceiptRow>();

/** id は R2 のオブジェクトキーと対応させるため service 層で採番した値を受け取る。 */
export const insertReceipt = async (
    db: D1Database,
    input: {
        id: string;
        objectKey: string;
        contentType: string;
        byteSize: number;
    },
): Promise<ReceiptRow> => {
    const id = input.id;
    const now = new Date().toISOString();
    await db
        .prepare(
            `INSERT INTO receipts
                (id, object_key, content_type, byte_size, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'uploaded', ?5, ?5)`,
        )
        .bind(id, input.objectKey, input.contentType, input.byteSize, now)
        .run();
    const inserted = await findReceipt(db, id);
    if (!inserted) {
        throw new Error("Inserted receipt could not be read back");
    }
    return inserted;
};

/** 取込履歴の一覧。`(created_at, id)` の降順で cursor paging する。 */
export const listReceipts = async (
    db: D1Database,
    query: ReceiptListQueryRow,
): Promise<ReceiptListResult> => {
    const conditions: string[] = [];
    const bindings: (string | number)[] = [];
    if (query.status !== null) {
        bindings.push(query.status);
        conditions.push(`r.status = ?${bindings.length}`);
    }
    if (query.cursor) {
        bindings.push(query.cursor.createdAt, query.cursor.id);
        const createdAtIndex = bindings.length - 1;
        conditions.push(
            `(r.created_at < ?${createdAtIndex} OR (r.created_at = ?${createdAtIndex} AND r.id < ?${bindings.length}))`,
        );
    }
    bindings.push(query.limit + 1);
    const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await db
        .prepare(
            `SELECT ${receiptColumns}
             FROM receipts AS r
             ${where}
             ORDER BY r.created_at DESC, r.id DESC
             LIMIT ?${bindings.length}`,
        )
        .bind(...bindings)
        .all<ReceiptRow>();
    return {
        rows: result.results.slice(0, query.limit),
        hasMore: result.results.length > query.limit,
    };
};

// SQLite に真偽値型が無く stock_relevant は 0 / 1 で返るため、行の型を跨ぐ前に変換する
interface ReceiptLineSelectRow extends Omit<ReceiptLineRow, "stockRelevant"> {
    stockRelevant: number;
}

const toReceiptLineRow = (row: ReceiptLineSelectRow): ReceiptLineRow => ({
    ...row,
    stockRelevant: row.stockRelevant !== 0,
});

export const listReceiptLines = async (
    db: D1Database,
    receiptId: string,
): Promise<ReceiptLineRow[]> => {
    const result = await db
        .prepare(
            `SELECT ${receiptLineColumns}
             FROM receipt_lines
             WHERE receipt_id = ?1
             ORDER BY line_no ASC`,
        )
        .bind(receiptId)
        .all<ReceiptLineSelectRow>();
    return result.results.map(toReceiptLineRow);
};

/**
 * 解析の状態遷移。反映が始まったレシート（`purchase_id` が入っている）と
 * 反映済みのレシートは対象外にする。無条件 UPDATE にすると、反映処理の途中で
 * 走った解析が明細を入れ替えてしまい、在庫だけ動いて根拠が消える。
 * 条件に合う行が無ければ false を返し、呼び出し側で衝突として扱わせる。
 */
export const updateReceiptStatus = async (
    db: D1Database,
    id: string,
    input: { status: ReceiptStatus; errorMessage: string | null },
): Promise<boolean> => {
    const result = await db
        .prepare(
            `UPDATE receipts
             SET status = ?2, error_message = ?3, updated_at = ?4
             WHERE id = ?1 AND purchase_id IS NULL AND status <> 'applied'`,
        )
        .bind(id, input.status, input.errorMessage, new Date().toISOString())
        .run();
    return (result.meta.changes ?? 0) > 0;
};

/**
 * 解析結果を全置換で保存する。再解析でも `(receipt_id, line_no)` が衝突しないよう
 * 既存行を削除してから挿入し、レシート本体の更新まで 1 batch（= 1 トランザクション）で行う。
 */
export const saveReceiptParseResult = async (
    db: D1Database,
    id: string,
    input: {
        storeName: string | null;
        purchasedAt: string | null;
        totalPrice: number | null;
        model: string;
        lines: readonly ReceiptLineWrite[];
    },
): Promise<void> => {
    const now = new Date().toISOString();
    const statements = [
        db.prepare(`DELETE FROM receipt_lines WHERE receipt_id = ?1`).bind(id),
        ...input.lines.map((line) =>
            db
                .prepare(
                    `INSERT INTO receipt_lines
                        (id, receipt_id, line_no, raw_name, completed_name, normalized_name, quantity, price,
                         printed_expiry_date, estimated_expiry_date, expiry_source,
                         expiry_confidence, expiry_reason, stock_relevant,
                         suggested_category_id, suggested_category_name,
                         suggested_base_unit, suggested_base_dimension,
                         created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19)`,
                )
                .bind(
                    newId(),
                    id,
                    line.lineNo,
                    line.rawName,
                    line.completedName,
                    line.normalizedName,
                    line.quantity,
                    line.price,
                    line.printedExpiryDate,
                    line.estimatedExpiryDate,
                    line.expirySource,
                    line.expiryConfidence,
                    line.expiryReason,
                    line.stockRelevant ? 1 : 0,
                    line.suggestedCategoryId,
                    line.suggestedCategoryName,
                    line.suggestedBaseUnit,
                    line.suggestedBaseDimension,
                    now,
                ),
        ),
        db
            .prepare(
                `UPDATE receipts
                 SET status = 'parsed',
                     store_name = ?2,
                     purchased_at = ?3,
                     total_price = ?4,
                     model = ?5,
                     error_message = NULL,
                     updated_at = ?6
                 WHERE id = ?1`,
            )
            .bind(
                id,
                input.storeName,
                input.purchasedAt,
                input.totalPrice,
                input.model,
                now,
            ),
    ];
    await db.batch(statements);
};

/** 照合結果を 1 batch で書き戻す。行ごとの UPDATE を直列に投げない。 */
export const updateReceiptLineMatches = async (
    db: D1Database,
    updates: readonly ReceiptLineMatchWrite[],
): Promise<void> => {
    if (updates.length === 0) {
        return;
    }
    const now = new Date().toISOString();
    await db.batch(
        updates.map((update) =>
            db
                .prepare(
                    `UPDATE receipt_lines
                     SET matched_item_id = ?2, match_method = ?3, match_score = ?4, updated_at = ?5
                     WHERE id = ?1`,
                )
                .bind(
                    update.id,
                    update.matchedItemId,
                    update.matchMethod,
                    update.matchScore,
                    now,
                ),
        ),
    );
};

/**
 * 承認された行の反映先を確定させる。`create_item` で作った品目を再実行で
 * 作り直さないため、在庫を動かす前にこの列を書く。
 */
export const setReceiptLineMatch = async (
    db: D1Database,
    lineId: string,
    input: {
        matchedItemId: string;
        matchMethod: ReceiptMatchMethodValue;
        matchScore: number | null;
    },
): Promise<void> => {
    await db
        .prepare(
            `UPDATE receipt_lines
             SET matched_item_id = ?2, match_method = ?3, match_score = ?4, updated_at = ?5
             WHERE id = ?1`,
        )
        .bind(
            lineId,
            input.matchedItemId,
            input.matchMethod,
            input.matchScore,
            new Date().toISOString(),
        )
        .run();
};

/**
 * 行に実際に反映された内容を記録する。解析値の列は触らない。
 * `skip` は在庫を動かさないため、既に実績のある行を後からの `skip` で
 * 塗り潰さない条件を付ける（部分反映のレシートを送り直したときに、
 * 既に在庫が動いた行の記録が消えないようにする）。
 */
export const recordReceiptLineApplied = async (
    db: D1Database,
    lineId: string,
    input: {
        action: ReceiptApplyAction;
        quantity: number | null;
        baseUnit: string | null;
        price: number | null;
        expiryDate: string | null;
        appliedAt: string;
    },
): Promise<void> => {
    await db
        .prepare(
            `UPDATE receipt_lines
             SET applied_action = ?2, applied_quantity = ?3, applied_base_unit = ?4,
                 applied_price = ?5, applied_expiry_date = ?6, applied_at = ?7,
                 updated_at = ?8
             WHERE id = ?1
               AND (?2 <> 'skip' OR applied_action IS NULL OR applied_action = 'skip')`,
        )
        .bind(
            lineId,
            input.action,
            input.quantity,
            input.baseUnit,
            input.price,
            input.expiryDate,
            input.appliedAt,
            new Date().toISOString(),
        )
        .run();
};

/**
 * 反映完了の記録。購入が入れ替わっていないことを条件にする（CAS）。
 * 無条件 UPDATE にすると、別リクエストが進めた状態を上書きしてしまう。
 */
export const markReceiptApplied = async (
    db: D1Database,
    id: string,
    input: { purchaseId: string; appliedAt: string },
): Promise<boolean> => {
    const result = await db
        .prepare(
            `UPDATE receipts
             SET status = 'applied', applied_at = ?3,
                 error_message = NULL, updated_at = ?4
             WHERE id = ?1 AND purchase_id = ?2`,
        )
        .bind(id, input.purchaseId, input.appliedAt, new Date().toISOString())
        .run();
    return (result.meta.changes ?? 0) > 0;
};

/**
 * レシートの購入イベントを 1 件だけ作り、レシートへ結び付ける（反映の開始宣言）。
 * INSERT と UPDATE の前提条件を同じにして、購入だけが作られる状態を残さない。
 * 購入の作成と結び付けを 1 batch（= 1 トランザクション）で行い、
 * 途中失敗で「購入だけ存在してレシートから辿れない」状態を作らない。
 * 既に反映が始まっているレシートには新しい購入を作らないため、
 * 別の idempotency key で再送されても購入は 2 件にならない。
 * 反映開始後は解析と削除を拒否できるよう、この列を進行中の目印として使う。
 */
export const claimReceiptPurchase = async (
    db: D1Database,
    receiptId: string,
    input: {
        source: string;
        purchasedAt: string;
        note: string | null;
        idempotencyKey: string;
    },
): Promise<void> => {
    const now = new Date().toISOString();
    await db.batch([
        db
            .prepare(
                `INSERT INTO purchases
                    (id, source, purchased_at, note, idempotency_key, created_at)
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6
                 WHERE EXISTS (
                     SELECT 1 FROM receipts
                     WHERE id = ?7 AND purchase_id IS NULL AND status = 'parsed'
                 )
                 ON CONFLICT(idempotency_key) DO NOTHING`,
            )
            .bind(
                newId(),
                input.source,
                input.purchasedAt,
                input.note,
                input.idempotencyKey,
                now,
                receiptId,
            ),
        db
            .prepare(
                `UPDATE receipts
                 SET purchase_id = (
                         SELECT id FROM purchases WHERE idempotency_key = ?2
                     ),
                     updated_at = ?3
                 WHERE id = ?1 AND purchase_id IS NULL AND status = 'parsed'`,
            )
            .bind(receiptId, input.idempotencyKey, now),
    ]);
};

export const findPurchaseById = async (
    db: D1Database,
    id: string,
): Promise<PurchaseRow | null> =>
    db
        .prepare(
            `SELECT id, source, purchased_at AS purchasedAt, note,
                    idempotency_key AS idempotencyKey, created_at AS createdAt
             FROM purchases
             WHERE id = ?1
             LIMIT 1`,
        )
        .bind(id)
        .first<PurchaseRow>();

/** この購入を根拠にしている他のレシートがあるか。key の使い回しを検出する。 */
export const purchaseBelongsToOtherReceipt = async (
    db: D1Database,
    purchaseId: string,
    receiptId: string,
): Promise<boolean> =>
    (await db
        .prepare(
            `SELECT 1 AS present FROM receipts
             WHERE purchase_id = ?1 AND id <> ?2
             LIMIT 1`,
        )
        .bind(purchaseId, receiptId)
        .first<{ present: number }>()) !== null;

/**
 * `create_item` で使う品目 ID を行へ先行予約する。品目を作る前に確定させることで、
 * 品目作成の直後に失敗しても、再実行が同じ ID の品目を探して再利用でき、
 * 同名の孤児品目が増えない。既に予約済みなら保存済みの値を返す。
 */
export const reserveReceiptLineItemId = async (
    db: D1Database,
    lineId: string,
    candidateId: string,
): Promise<string> => {
    await db
        .prepare(
            `UPDATE receipt_lines
             SET pending_item_id = COALESCE(pending_item_id, ?2), updated_at = ?3
             WHERE id = ?1`,
        )
        .bind(lineId, candidateId, new Date().toISOString())
        .run();
    const row = await db
        .prepare(
            `SELECT pending_item_id AS pendingItemId FROM receipt_lines WHERE id = ?1`,
        )
        .bind(lineId)
        .first<{ pendingItemId: string | null }>();
    if (!row || row.pendingItemId === null) {
        throw new Error("Reserved item id could not be read back");
    }
    return row.pendingItemId;
};

export const deleteReceipt = async (
    db: D1Database,
    id: string,
): Promise<boolean> => {
    // 明細は receipt_lines の ON DELETE cascade で消える
    const result = await db
        .prepare(`DELETE FROM receipts WHERE id = ?1`)
        .bind(id)
        .run();
    return (result.meta.changes ?? 0) > 0;
};

/**
 * 照合の母集合。表記ゆれの吸収は正規化した文字列同士の比較で行うため、
 * SQL では絞り込めず品目名を読み出す。件数上限を超える規模では
 * 類似度候補が欠けるため、上限を service 層の定数で明示する。
 */
/** 照合済み品目の表示名を IN 句 1 回で解決する。 */
export const listItemNamesByIds = async (
    db: D1Database,
    itemIds: readonly string[],
): Promise<Map<string, string>> => {
    if (itemIds.length === 0) {
        return new Map();
    }
    const placeholders = itemIds.map(() => "?").join(", ");
    const result = await db
        .prepare(`SELECT id, name FROM items WHERE id IN (${placeholders})`)
        .bind(...itemIds)
        .all<MatchableItemRow>();
    return new Map(result.results.map((row) => [row.id, row.name]));
};

export const listMatchableItems = async (
    db: D1Database,
    limit: number,
): Promise<MatchableItemRow[]> => {
    const result = await db
        .prepare(
            `SELECT id, name FROM items ORDER BY name ASC, id ASC LIMIT ?1`,
        )
        .bind(limit)
        .all<MatchableItemRow>();
    return result.results;
};

/** 正規化表記の IN 句 1 回で辞書を引く（行ごとに問い合わせない）。 */
export const listItemAliasesByNormalizedNames = async (
    db: D1Database,
    normalizedNames: readonly string[],
): Promise<Map<string, string>> => {
    if (normalizedNames.length === 0) {
        return new Map();
    }
    const placeholders = normalizedNames.map(() => "?").join(", ");
    const result = await db
        .prepare(
            `SELECT normalized_name AS normalizedName, item_id AS itemId
             FROM item_aliases
             WHERE normalized_name IN (${placeholders})`,
        )
        .bind(...normalizedNames)
        .all<ItemAliasRow>();
    return new Map(
        result.results.map((row) => [row.normalizedName, row.itemId]),
    );
};

/**
 * 表記を辞書へ登録する。既に登録済みの表記は品目が違っても書き換えない
 * （1 つの表記は 1 品目にしか結び付かず、他品目から奪わない）。
 * 追加された場合だけ true を返す。
 */
export const insertItemAliasIfAbsent = async (
    db: D1Database,
    input: {
        itemId: string;
        normalizedName: string;
        displayName: string;
        source: "receipt" | "manual";
    },
): Promise<boolean> => {
    const result = await db
        .prepare(
            `INSERT INTO item_aliases
                (id, item_id, normalized_name, display_name, source, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(normalized_name) DO NOTHING`,
        )
        .bind(
            newId(),
            input.itemId,
            input.normalizedName,
            input.displayName,
            input.source,
            new Date().toISOString(),
        )
        .run();
    return (result.meta.changes ?? 0) > 0;
};

export const findPurchaseByIdempotencyKey = async (
    db: D1Database,
    idempotencyKey: string,
): Promise<PurchaseRow | null> =>
    db
        .prepare(
            `SELECT id, source, purchased_at AS purchasedAt, note,
                    idempotency_key AS idempotencyKey, created_at AS createdAt
             FROM purchases
             WHERE idempotency_key = ?1
             LIMIT 1`,
        )
        .bind(idempotencyKey)
        .first<PurchaseRow>();

/** 価格履歴の正規化に必要な基準単位を IN 句 1 回で解決する。 */
export const listItemPricingContexts = async (
    db: D1Database,
    itemIds: readonly string[],
): Promise<Map<string, ItemPricingRow>> => {
    if (itemIds.length === 0) {
        return new Map();
    }
    const placeholders = itemIds.map(() => "?").join(", ");
    const result = await db
        .prepare(
            `SELECT id, base_unit AS baseUnit, base_dimension AS baseDimension
             FROM items
             WHERE id IN (${placeholders})`,
        )
        .bind(...itemIds)
        .all<ItemPricingRow>();
    return new Map(result.results.map((row) => [row.id, row]));
};

/**
 * 反映済みレシートから取り出した実例 1 件。`corrected` は SQLite が 0/1 で返すため
 * 数値で受け、真偽値への変換は service 層で行う。
 */
export interface ReceiptExampleRow {
    rawName: string;
    completedName: string | null;
    normalizedName: string;
    itemName: string;
    baseUnit: string;
    baseDimension: ReceiptBaseDimension;
    categoryName: string;
    storeName: string | null;
    suggestedBaseUnit: string | null;
    suggestedBaseDimension: ReceiptBaseDimension | null;
    suggestedCategoryName: string | null;
    corrected: number;
    appliedAt: string;
}

export interface ReceiptExampleQueryRow {
    /** 正規化済みの表記。null は「表記で絞らず最近の例を返す」を意味する */
    normalizedNames: readonly string[] | null;
    limit: number;
    correctedOnly: boolean;
}

/**
 * 反映済みレシートの明細を、次回以降の解析が参照できる実例として読む。
 * `match_method = 'manual'` は反映時に applyReceipt が書く値で「利用者が承認して
 * 在庫へ反映した行」を表すため、取り込まなかった行と下書きは自然に外れる。
 * 同じ表記の例が何件も返らないよう、正規化表記ごとに最後に反映した 1 件へ畳む。
 */
export const listAppliedReceiptLineExamples = async (
    db: D1Database,
    query: ReceiptExampleQueryRow,
): Promise<ReceiptExampleRow[]> => {
    if (query.normalizedNames !== null && query.normalizedNames.length === 0) {
        return [];
    }
    const binds: (string | number)[] = [];
    let nameFilter = "";
    if (query.normalizedNames !== null) {
        const placeholders = query.normalizedNames.map(() => "?").join(", ");
        nameFilter = `AND rl.normalized_name IN (${placeholders})`;
        binds.push(...query.normalizedNames);
    }
    // 表記を指定した呼び出しは正規化表記ごとに 1 件へ畳まれるため件数が表記数を
    // 超えず、ここで LIMIT を掛けると答えられた表記が黙って落ちて「例が無い」と
    // 見分けが付かなくなる。上限は表記で絞らない一覧のときだけ効かせる
    let limitClause = "";
    if (query.normalizedNames === null) {
        limitClause = "LIMIT ?";
        binds.push(query.limit);
    }
    const result = await db
        .prepare(
            `WITH examples AS (
                 SELECT rl.raw_name AS rawName,
                        rl.completed_name AS completedName,
                        rl.normalized_name AS normalizedName,
                        i.name AS itemName,
                        i.base_unit AS baseUnit,
                        i.base_dimension AS baseDimension,
                        c.name AS categoryName,
                        COALESCE(p.source, r.store_name) AS storeName,
                        rl.suggested_base_unit AS suggestedBaseUnit,
                        rl.suggested_base_dimension AS suggestedBaseDimension,
                        rl.suggested_category_name AS suggestedCategoryName,
                        -- 単位だけは綴りを畳んでから比べる。解析の提案は保存時に
                        -- 単位表の綴りへ正規化する（ml → mL）のに対し、品目側は
                        -- 旧表記のまま残るため、素で比べると同じ単位が「訂正された」
                        -- 例に化けて correctedOnly の枠を埋めてしまう。畳むのは
                        -- ASCII の大小文字だけで、単位表に無い表記（袋・パック）は
                        -- どちらの側も変わらない
                        CASE WHEN (rl.suggested_base_unit IS NOT NULL
                                     AND LOWER(rl.suggested_base_unit) <> LOWER(i.base_unit))
                                  OR (rl.suggested_base_dimension IS NOT NULL
                                     AND rl.suggested_base_dimension <> i.base_dimension)
                                  OR (rl.suggested_category_id IS NOT NULL
                                     AND rl.suggested_category_id <> i.category_id)
                                  OR (rl.completed_name IS NOT NULL
                                     AND rl.completed_name <> i.name)
                             THEN 1 ELSE 0 END AS corrected,
                        r.applied_at AS appliedAt,
                        ROW_NUMBER() OVER (
                            PARTITION BY rl.normalized_name
                            ORDER BY r.applied_at DESC, rl.id DESC
                        ) AS rn
                 FROM receipt_lines AS rl
                 JOIN receipts AS r
                   ON r.id = rl.receipt_id AND r.applied_at IS NOT NULL
                 JOIN items AS i ON i.id = rl.matched_item_id
                 JOIN categories AS c ON c.id = i.category_id
                 LEFT JOIN purchases AS p ON p.id = r.purchase_id
                 WHERE rl.match_method = 'manual'
                   -- 反映実績が skip の行は在庫へ届いていない。列を持たない
                   -- 移行前の行は NULL のままなので、match_method だけで絞る
                   AND (rl.applied_action IS NULL OR rl.applied_action <> 'skip')
                   ${nameFilter}
             )
             SELECT rawName, completedName, normalizedName, itemName, baseUnit,
                    baseDimension, categoryName, storeName, suggestedBaseUnit,
                    suggestedBaseDimension, suggestedCategoryName, corrected,
                    appliedAt
             FROM examples
             WHERE rn = 1${query.correctedOnly ? " AND corrected = 1" : ""}
             ORDER BY corrected DESC, appliedAt DESC
             ${limitClause}`,
        )
        .bind(...binds)
        .all<ReceiptExampleRow>();
    return result.results;
};
