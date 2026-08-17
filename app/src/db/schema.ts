import { sql } from "drizzle-orm";
import {
    type AnySQLiteColumn,
    check,
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";

// 全テーブルの主キーは UUIDv7（domain/id.ts の newId で生成）
export const categoryKinds = [
    "daily_goods",
    "food",
    "book",
    "document",
] as const;

export const unitDimensions = ["mass", "volume", "count"] as const;

export const stockMovementReasons = [
    "purchase",
    "stocktake",
    "consume",
    "discard",
    "other",
] as const;

export const stockOperationKinds = ["adjustment", "stocktake"] as const;

export const readingStatuses = ["unread", "reading", "finished"] as const;

export const storageLocations = sqliteTable(
    "storage_locations",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        // ルート階層は null。子を持つ場所の削除は restrict で禁止する
        parentId: text("parent_id").references(
            (): AnySQLiteColumn => storageLocations.id,
            {
                onDelete: "restrict",
            },
        ),
        // 同一階層内の表示順
        sortOrder: integer("sort_order").notNull().default(0),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [
        // 同一階層内の同名を禁止する。SQLite は NULL 同士を別値として扱うため、
        // parent_id が NULL のルート同士の重複だけは service 層で検証する
        uniqueIndex("uq_storage_locations_parent_name").on(t.parentId, t.name),
        check(
            "ck_storage_locations_name_not_empty",
            sql`length(${t.name}) > 0`,
        ),
    ],
);

export const categories = sqliteTable(
    "categories",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        // ルート階層は null。子を持つカテゴリーの削除は restrict で禁止する
        parentId: text("parent_id").references(
            (): AnySQLiteColumn => categories.id,
            {
                onDelete: "restrict",
            },
        ),
        // 書類の既定値（数量 1・単位「件」）や書籍固有機能の判定に使う。
        // null は汎用カテゴリーで、実効 kind は祖先を遡って解決する
        kind: text("kind", { enum: categoryKinds }),
        // 同一階層内の表示順
        sortOrder: integer("sort_order").notNull().default(0),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [
        // 同一階層内の同名を禁止する。parent_id が NULL のルート同士は
        // SQLite の NULL 別値扱いにより対象外のため service 層で検証する
        uniqueIndex("uq_categories_parent_name").on(t.parentId, t.name),
        check(
            "ck_categories_kind",
            sql`${t.kind} is null or ${t.kind} in ('daily_goods', 'food', 'book', 'document')`,
        ),
        check("ck_categories_name_not_empty", sql`length(${t.name}) > 0`),
    ],
);

export const items = sqliteTable(
    "items",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        // カテゴリーは 1 つのみ。ツリー上の任意ノード（中間・末端どちらも）を指定できる。
        // 商品が参照しているカテゴリーの削除は restrict で禁止する
        categoryId: text("category_id")
            .notNull()
            .references(() => categories.id, { onDelete: "restrict" }),
        // 保管場所は 1 か所のみ。商品が参照している場所の削除は restrict で禁止する
        locationId: text("location_id")
            .notNull()
            .references(() => storageLocations.id, { onDelete: "restrict" }),
        // 在庫集計の基準単位（g / mL / ロール / 冊 / 件 など）。商品作成後は変更不可
        baseUnit: text("base_unit").notNull(),
        // 異なるディメンション間の換算・比較は行わない
        baseDimension: text("base_dimension", {
            enum: unitDimensions,
        }).notNull(),
        // 基準単位での現在在庫。在庫の正は item_lots であり、この列は一覧表示と
        // 在庫下限判定のための維持キャッシュとして書き込みバッチ末尾で再計算する
        currentQuantity: integer("current_quantity").notNull().default(0),
        // 基準単位での在庫下限。在庫不足判定に使用する
        lowStockThreshold: integer("low_stock_threshold"),
        memo: text("memo"),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [
        index("idx_items_location").on(t.locationId),
        index("idx_items_category").on(t.categoryId),
        index("idx_items_name").on(t.name),
        check(
            "ck_items_base_dimension",
            sql`${t.baseDimension} in ('mass', 'volume', 'count')`,
        ),
        // 負在庫は許可しない
        check(
            "ck_items_current_quantity_non_negative",
            sql`${t.currentQuantity} >= 0`,
        ),
        check(
            "ck_items_low_stock_threshold_non_negative",
            sql`${t.lowStockThreshold} is null or ${t.lowStockThreshold} >= 0`,
        ),
        check("ck_items_name_not_empty", sql`length(${t.name}) > 0`),
    ],
);

// 期限別の在庫ロット。在庫数量の正はこのテーブルで、items.current_quantity は
// ロット合計から再計算されるキャッシュである。保管場所は品目単位のためロットは持たない。
// 数量 0 のロット行は削除しない（stock_movement_lot_allocations が参照する）。
// 既定の表示と FEFO 配分の対象からは service 層で除外する
export const itemLots = sqliteTable(
    "item_lots",
    {
        id: text("id").primaryKey(),
        itemId: text("item_id")
            .notNull()
            .references(() => items.id, { onDelete: "restrict" }),
        // ISO 8601 UTC。NULL は「期限なしロット」を表す
        expiryDate: text("expiry_date"),
        quantity: integer("quantity").notNull().default(0),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [
        uniqueIndex("uq_item_lots_item_expiry").on(t.itemId, t.expiryDate),
        // SQLite は NULL 同士を別値として扱い上の unique index が効かないため、
        // 期限なしロットの重複は部分 unique index で禁止する。
        // 期限なしロットへの upsert はこの index を conflict target に使う
        uniqueIndex("uq_item_lots_item_no_expiry")
            .on(t.itemId)
            .where(sql`${t.expiryDate} is null`),
        // 期限接近の横断検索用
        index("idx_item_lots_expiry").on(t.expiryDate, t.itemId),
        // 負在庫は許可しない。出庫時の在庫不足はこの CHECK で batch 全体を rollback させる
        check("ck_item_lots_quantity_non_negative", sql`${t.quantity} >= 0`),
    ],
);

// 書籍カテゴリーの品目だけが持つ読書状態。品目と 1:1 で、items へ列を足さずに
// 別テーブルへ分離している。ISBN などの識別子も将来 item_identifiers として
// 別エンティティで追加する方針のため、この分離により書籍固有の情報が増えても
// items のスキーマと既存の在庫契約は変わらない。
// 品目を消す前に読書状態を消す運用にするため FK は restrict とする
export const itemReadingStates = sqliteTable(
    "item_reading_states",
    {
        itemId: text("item_id")
            .primaryKey()
            .references(() => items.id, { onDelete: "restrict" }),
        status: text("status", { enum: readingStatuses }).notNull(),
        // ISO 8601 UTC。未読・読書中では未設定になり得るため nullable
        startedAt: text("started_at"),
        finishedAt: text("finished_at"),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [
        // 状態での絞り込みと (status, item_id) による安定順のため
        index("idx_item_reading_states_status").on(t.status, t.itemId),
        check(
            "ck_item_reading_states_status",
            sql`${t.status} in ('unread', 'reading', 'finished')`,
        ),
        // 状態と日付の矛盾を規則ごとに別 CHECK で禁止する。
        // 未読なら開始日・読了日は持たない
        check(
            "ck_item_reading_states_unread_dates",
            sql`${t.status} <> 'unread' or (${t.startedAt} is null and ${t.finishedAt} is null)`,
        ),
        // 読書中なら読了日は持たない
        check(
            "ck_item_reading_states_reading_dates",
            sql`${t.status} <> 'reading' or ${t.finishedAt} is null`,
        ),
        // 両方ある場合の前後関係。ISO 8601 UTC 固定書式のため辞書順比較で判定できる
        check(
            "ck_item_reading_states_date_order",
            sql`${t.startedAt} is null or ${t.finishedAt} is null or ${t.finishedAt} >= ${t.startedAt}`,
        ),
    ],
);

// 購入イベント。stock_movements（在庫増）と price_records（価格明細）を 1 つの
// 購入行為として束ね、コメントと（フェーズ 2 の）レシートの結び付け先になる。
// 合計金額は明細から導出するため持たない。レシート由来の場合はフェーズ 2 で
// receipt_id を追加する（SQLite の ALTER ADD COLUMN は UNIQUE を付けられないため
// 1:1 制約は別途 unique index で張る）
export const purchases = sqliteTable(
    "purchases",
    {
        id: text("id").primaryKey(),
        // 店舗名などの購入元。店舗・価格を記録しないクイック入庫は
        // purchases 行を作らず stock_movements 単独で記録する
        source: text("source").notNull(),
        purchasedAt: text("purchased_at").notNull(),
        // 購入単位の自由コメント
        note: text("note"),
        // レシート承認や外部クライアント再送による購入全体の二重反映を防ぐ
        idempotencyKey: text("idempotency_key"),
        // 購入イベントは不変のため updated_at を持たない
        createdAt: text("created_at").notNull(),
    },
    (t) => [
        uniqueIndex("uq_purchases_idempotency_key").on(t.idempotencyKey),
        // 購入履歴一覧の cursor paging 用
        index("idx_purchases_purchased_at").on(t.purchasedAt, t.id),
        check("ck_purchases_source_not_empty", sql`length(${t.source}) > 0`),
    ],
);

export const stockMovements = sqliteTable(
    "stock_movements",
    {
        id: text("id").primaryKey(),
        itemId: text("item_id")
            .notNull()
            .references(() => items.id, { onDelete: "restrict" }),
        // 基準単位での増減量。棚卸しの絶対値入力は service 層で差分へ変換してから記録する
        delta: integer("delta").notNull(),
        reason: text("reason", { enum: stockMovementReasons }).notNull(),
        // 購入イベントへの紐付け。reason = 'purchase' の行だけ設定できる。
        // 履歴を孤児にしないため、参照されている購入の削除は restrict で禁止する
        purchaseId: text("purchase_id").references(() => purchases.id, {
            onDelete: "restrict",
        }),
        occurredAt: text("occurred_at").notNull(),
        // 再送による二重反映を防ぐ。外部クライアントからの在庫調整では必須
        idempotencyKey: text("idempotency_key"),
        // 履歴は不変のため updated_at を持たない
        createdAt: text("created_at").notNull(),
    },
    (t) => [
        uniqueIndex("uq_stock_movements_idempotency_key").on(t.idempotencyKey),
        // 同一購入内の同一商品は service 層で delta を合算し 1 movement へ統合する
        // （price_records は包装違いなどで同一商品が複数行あってよい）。
        // SQLite は NULL を別値扱いするため purchase_id が NULL の行には影響しない
        uniqueIndex("uq_stock_movements_purchase_item").on(
            t.purchaseId,
            t.itemId,
        ),
        // 履歴一覧の cursor paging 用。(occurred_at, id) で順序を一意に安定させる
        index("idx_stock_movements_item_occurred").on(
            t.itemId,
            t.occurredAt,
            t.id,
        ),
        // 全商品の履歴一覧の cursor paging 用
        index("idx_stock_movements_occurred").on(t.occurredAt, t.id),
        // 期限ごとの棚卸しでは合計差分 0 でロット内訳だけが変わる正当な操作があるため、
        // reason = 'stocktake' に限り delta 0 を許可する
        check(
            "ck_stock_movements_delta_not_zero",
            sql`${t.delta} <> 0 or ${t.reason} = 'stocktake'`,
        ),
        // 購入以外の理由の movement が購入を参照することを禁止する。
        // 逆方向（purchase なら purchase_id 必須）はクイック入庫を許すため課さない
        check(
            "ck_stock_movements_purchase_reason",
            sql`${t.purchaseId} is null or ${t.reason} = 'purchase'`,
        ),
        check(
            "ck_stock_movements_reason",
            sql`${t.reason} in ('purchase', 'stocktake', 'consume', 'discard', 'other')`,
        ),
    ],
);

// 1 movement の増減をどのロットへどれだけ割り当てたかの内訳。追加のみで不変。
// 0005 より前に記録された movement には allocation が存在しない（ロット追跡前の履歴）。
// これは仕様であり、履歴表示では空配列として扱う
export const stockMovementLotAllocations = sqliteTable(
    "stock_movement_lot_allocations",
    {
        id: text("id").primaryKey(),
        movementId: text("movement_id")
            .notNull()
            .references(() => stockMovements.id, { onDelete: "restrict" }),
        lotId: text("lot_id")
            .notNull()
            .references(() => itemLots.id, { onDelete: "restrict" }),
        // 記録時点のロット期限のスナップショット。ロットの期限は後から変更できるため、
        // 参照で解決すると過去の履歴の期限まで書き換わってしまう。NULL は期限なしロット
        expiryDate: text("expiry_date"),
        delta: integer("delta").notNull(),
        createdAt: text("created_at").notNull(),
    },
    (t) => [
        uniqueIndex("uq_stock_movement_lot_allocations_movement_lot").on(
            t.movementId,
            t.lotId,
        ),
        // ロットごとの増減履歴の逆引き用
        index("idx_stock_movement_lot_allocations_lot").on(
            t.lotId,
            t.createdAt,
        ),
        check(
            "ck_stock_movement_lot_allocations_delta_not_zero",
            sql`${t.delta} <> 0`,
        ),
    ],
);

// 在庫操作の受付記録。movement が 0 件になる棚卸しの no-op も記録し、
// idempotency key の再送を同じ結果として扱えるようにする。
// 行は service 層から追加するだけで、修正用の updated_at は持たない。
export const stockOperations = sqliteTable(
    "stock_operations",
    {
        idempotencyKey: text("idempotency_key").primaryKey(),
        itemId: text("item_id")
            .notNull()
            .references(() => items.id, { onDelete: "restrict" }),
        kind: text("kind", { enum: stockOperationKinds }).notNull(),
        delta: integer("delta").notNull(),
        targetQuantity: integer("target_quantity"),
        reason: text("reason", { enum: stockMovementReasons }).notNull(),
        occurredAt: text("occurred_at").notNull(),
        // occurred_at が入力省略による自動値かどうか。再送比較に使う。
        occurredAtProvided: integer("occurred_at_provided")
            .notNull()
            .default(0),
        // no-op 棚卸しでは movement が存在しないため nullable
        movementId: text("movement_id"),
        resultingQuantity: integer("resulting_quantity").notNull(),
        createdAt: text("created_at").notNull(),
        // ロット指定を含む再送リクエストの同一性判定に使う正規化リクエストの SHA-256 hex。
        // 0005 より前の既存行は NULL で、その場合は従来のフィールド比較へフォールバックする。
        // ALTER ADD COLUMN で末尾に追加されるため宣言順も末尾に合わせる
        requestDigest: text("request_digest"),
    },
    (t) => [
        index("idx_stock_operations_item_created").on(
            t.itemId,
            t.createdAt,
            t.idempotencyKey,
        ),
        check(
            "ck_stock_operations_kind",
            sql`${t.kind} in ('adjustment', 'stocktake')`,
        ),
        check(
            "ck_stock_operations_reason",
            sql`${t.reason} in ('purchase', 'stocktake', 'consume', 'discard', 'other')`,
        ),
        check(
            "ck_stock_operations_occurred_at_provided",
            sql`${t.occurredAtProvided} in (0, 1)`,
        ),
        check(
            "ck_stock_operations_payload",
            sql`(${t.kind} = 'stocktake' and ${t.targetQuantity} is not null) or (${t.kind} = 'adjustment' and ${t.targetQuantity} is null and ${t.delta} <> 0)`,
        ),
        check(
            "ck_stock_operations_target_quantity_non_negative",
            sql`${t.targetQuantity} is null or ${t.targetQuantity} >= 0`,
        ),
        check(
            "ck_stock_operations_resulting_quantity_non_negative",
            sql`${t.resultingQuantity} >= 0`,
        ),
    ],
);

export const priceRecords = sqliteTable(
    "price_records",
    {
        id: text("id").primaryKey(),
        itemId: text("item_id")
            .notNull()
            .references(() => items.id, { onDelete: "cascade" }),
        // 購入明細のとき設定する。NULL は Amazon 手動入力などの価格観測のみの行。
        // 購入行でも source を保持するのは、価格比較を 1 テーブルで完結させるための
        // 非正規化（service が purchases.source を転記する）
        purchaseId: text("purchase_id").references(() => purchases.id, {
            onDelete: "restrict",
        }),
        // 商品の基準単位へ正規化した 1 個あたり内容量（kg→g、L→mL 変換後の整数）
        contentAmount: integer("content_amount").notNull(),
        // 2 本セットなら 2。総内容量 = content_amount × set_count
        setCount: integer("set_count").notNull().default(1),
        // ボトル、詰め替え、箱など
        packaging: text("packaging"),
        // 販売価格（円、整数）。単位あたり価格は保存せず表示時に計算する
        price: integer("price").notNull(),
        // Amazon、スーパーA などの取得元
        source: text("source").notNull(),
        url: text("url"),
        // 購入日時または価格取得日時（ISO 8601 UTC）
        recordedAt: text("recorded_at").notNull(),
        createdAt: text("created_at").notNull(),
    },
    (t) => [
        index("idx_price_records_item_recorded").on(
            t.itemId,
            t.recordedAt,
            t.id,
        ),
        index("idx_price_records_source").on(t.source),
        // 購入 → 明細の逆引き用
        index("idx_price_records_purchase").on(t.purchaseId),
        check(
            "ck_price_records_content_amount_positive",
            sql`${t.contentAmount} > 0`,
        ),
        check("ck_price_records_set_count_positive", sql`${t.setCount} >= 1`),
        check("ck_price_records_price_non_negative", sql`${t.price} >= 0`),
        check(
            "ck_price_records_source_not_empty",
            sql`length(${t.source}) > 0`,
        ),
    ],
);

// 外部連携の認証情報は SETTINGS_ENCRYPTION_KEY で暗号化して保存する。
// 平文や復号結果を D1・API response・log に含めない。
export const integrationCredentials = sqliteTable(
    "integration_credentials",
    {
        provider: text("provider", { enum: ["openrouter"] })
            .primaryKey()
            .notNull(),
        ciphertext: text("ciphertext").notNull(),
        initializationVector: text("initialization_vector").notNull(),
        encryptionVersion: integer("encryption_version").notNull().default(1),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [
        check(
            "ck_integration_credentials_provider",
            sql`${t.provider} = 'openrouter'`,
        ),
        check(
            "ck_integration_credentials_encryption_version",
            sql`${t.encryptionVersion} = 1`,
        ),
        check(
            "ck_integration_credentials_ciphertext_not_empty",
            sql`length(${t.ciphertext}) > 0`,
        ),
        check(
            "ck_integration_credentials_iv_not_empty",
            sql`length(${t.initializationVector}) > 0`,
        ),
    ],
);

// 外部連携の非機密設定。認証情報（integration_credentials）と分離することで、
// API key 未設定でもモデル選択だけを保存できる
export const integrationSettings = sqliteTable(
    "integration_settings",
    {
        provider: text("provider", { enum: ["openrouter"] })
            .primaryKey()
            .notNull(),
        // レシート読み取り等に使うマルチモーダル LLM のモデル ID
        chatModel: text("chat_model").notNull(),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [
        check(
            "ck_integration_settings_provider",
            sql`${t.provider} = 'openrouter'`,
        ),
        check(
            "ck_integration_settings_chat_model_not_empty",
            sql`length(${t.chatModel}) > 0`,
        ),
    ],
);
