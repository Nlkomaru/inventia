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

export const receiptStatuses = [
    "uploaded",
    "parsing",
    "parsed",
    "applied",
    "failed",
] as const;

export const receiptExpirySources = [
    "printed",
    "estimated",
    "unknown",
] as const;

export const receiptExpiryConfidences = ["high", "medium", "low"] as const;

export const receiptMatchMethods = [
    "exact",
    "alias",
    "similarity",
    "manual",
] as const;

export const itemAliasSources = ["receipt", "manual"] as const;

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
        // 在庫集計の基準単位（g / mL / ロール / 冊 / 件 など）。作成後も変更できるが、
        // 変更は換算を伴わないつけ替えで、保存済みの数量（current_quantity、
        // item_lots、stock_movements、価格の内容量）はどれも書き換えない
        baseUnit: text("base_unit").notNull(),
        // 異なるディメンション間の換算・比較は行わない。base_unit と同様に後から
        // 変更できるが、既存の数量はその数値のまま残り、表す意味だけが変わる
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
        // 一覧で品目を見分けるための絵文字 1 個。AI 生成に失敗しても品目作成を
        // 止めないため、既定のプレースホルダ '📦' を DEFAULT に持たせる。
        // 「絵文字 1 個」の判定は CHECK では書けないため domain/item.ts の
        // itemEmojiSchema で担保する（ALTER ADD COLUMN では table 制約を足せず、
        // 足そうとするとテーブル再構築になり既存データを危険にさらす）。
        // ALTER ADD COLUMN で末尾に追加されるため宣言順も末尾に合わせる
        emoji: text("emoji").notNull().default("📦"),
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

// 価格を記録した購入元の店舗。price_records.source（自由記述）を将来的に
// 置き換える正規化された参照先で、ファビコン画像は R2 に置きキーだけを持つ
export const stores = sqliteTable(
    "stores",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        // 店舗サイトなどの URL。任意
        url: text("url"),
        // R2（RECEIPTS binding）のオブジェクトキー。未アップロードなら null
        faviconObjectKey: text("favicon_object_key"),
        faviconContentType: text("favicon_content_type"),
        faviconByteSize: integer("favicon_byte_size"),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [
        uniqueIndex("uq_stores_name").on(t.name),
        check("ck_stores_name_not_empty", sql`length(${t.name}) > 0`),
        check(
            "ck_stores_favicon_byte_size_positive",
            sql`${t.faviconByteSize} is null or ${t.faviconByteSize} > 0`,
        ),
        // 画像の 3 列は「全て null」か「全て非 null」のどちらかしか取らない
        check(
            "ck_stores_favicon_columns_consistent",
            sql`(${t.faviconObjectKey} is null and ${t.faviconContentType} is null and ${t.faviconByteSize} is null)
                or (${t.faviconObjectKey} is not null and ${t.faviconContentType} is not null and ${t.faviconByteSize} is not null)`,
        ),
    ],
);

// 外部アプリ（料理アプリ等）への連携先。stock_movements から参照し、
// 在庫を何に使ったかの行き先を表す。ファビコンは URL 文字列で持ち、
// stores と違い画像そのものは保管しない
export const externalProviders = sqliteTable(
    "external_providers",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        // 連携先のファビコン画像の URL。任意
        faviconUrl: text("favicon_url"),
        // 連携先サイトの URL。任意
        url: text("url"),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [
        uniqueIndex("uq_external_providers_name").on(t.name),
        check(
            "ck_external_providers_name_not_empty",
            sql`length(${t.name}) > 0`,
        ),
    ],
);

// 購入イベント。stock_movements（在庫増）と price_records（価格明細）を 1 つの
// 購入行為として束ね、コメントとレシートの結び付け先になる。
// 合計金額は明細から導出するため持たない。レシートとの結び付けは receipts.purchase_id
// が持つため、この表にレシートへの参照列は持たない
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
        // 以下 3 列は ALTER ADD COLUMN で末尾に追加されるため宣言順も末尾に合わせる。
        // 用途の自由記述。reason（enum）では表せない「食べ物作成」などを記録する
        note: text("note"),
        // 在庫の行き先になった外部アプリ。参照されている連携先の削除は restrict で禁止する
        externalProviderId: text("external_provider_id").references(
            () => externalProviders.id,
            { onDelete: "restrict" },
        ),
        // 連携先アプリ側の ID。Inventia は解釈せず、保存と表示だけを行う。
        // 「external_id は external_provider_id が無いと持てない」制約は
        // ALTER ADD COLUMN では足せない（table 制約の追加はテーブル再構築を招く）ため、
        // services/stockService.ts で検証する
        externalId: text("external_id"),
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
        // 連携先 → 履歴の逆引きと、連携先が参照中かどうかの判定用
        index("idx_stock_movements_external").on(
            t.externalProviderId,
            t.externalId,
        ),
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
        // 購入元の店舗。既存行は null。source は表示互換のため残し、
        // storeId がある行では店舗名を転記した値になる
        storeId: text("store_id").references(() => stores.id, {
            onDelete: "restrict",
        }),
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
        // 店舗 → 価格の逆引きと参照中判定用
        index("idx_price_records_store").on(t.storeId),
        // 品目で絞らない価格一覧の cursor paging 用。(recorded_at, id) で順序を一意に安定させる
        index("idx_price_records_recorded_at").on(t.recordedAt, t.id),
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
        // レシート解析へ渡す指示。null は domain の既定を使うことを表し、
        // 既定と同じ内容を保存しないことで既定の改善が利用者へ届き続ける
        receiptPrompt: text("receipt_prompt"),
        // 解析時に MCP の読み取り tool を渡すか。0 / 1 で保持し、既定は渡さない
        receiptToolsEnabled: integer("receipt_tools_enabled")
            .notNull()
            .default(0),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
        // 品目の絵文字を生成する LLM のモデル ID。ALTER ADD COLUMN で末尾に
        // 追加されるため宣言順も末尾に合わせる
        emojiModel: text("emoji_model")
            .notNull()
            .default("deepseek/deepseek-v4-flash-0731"),
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

// 取り込んだレシート画像 1 枚の状態。画像そのものは R2（RECEIPTS binding）に置き、
// この表は object_key だけを持つ。承認前に在庫へ反映しないため、在庫・価格への
// 反映結果は purchase_id と applied_at にだけ現れる
export const receipts = sqliteTable(
    "receipts",
    {
        id: text("id").primaryKey(),
        // R2 のオブジェクトキー。1 レシート 1 オブジェクトのため unique
        objectKey: text("object_key").notNull(),
        contentType: text("content_type").notNull(),
        byteSize: integer("byte_size").notNull(),
        status: text("status", { enum: receiptStatuses }).notNull(),
        storeName: text("store_name"),
        // ISO 8601 UTC。レシート表記から読み取れない場合は null
        purchasedAt: text("purchased_at"),
        // レシート記載の合計金額（円、整数）。明細合計との突き合わせに使う
        totalPrice: integer("total_price"),
        // 解析に使った LLM のモデル ID
        model: text("model"),
        // 利用者が対処できる失敗理由だけを入れる。上流の例外文字列や API 応答を格納しない
        errorMessage: text("error_message"),
        // 適用後に設定する。購入履歴を孤児にしないため restrict
        purchaseId: text("purchase_id").references(() => purchases.id, {
            onDelete: "restrict",
        }),
        appliedAt: text("applied_at"),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [
        uniqueIndex("uq_receipts_object_key").on(t.objectKey),
        // 取込履歴一覧の cursor paging 用。(created_at, id) で順序を一意に安定させる
        index("idx_receipts_created_at").on(t.createdAt, t.id),
        index("idx_receipts_status").on(t.status),
        check("ck_receipts_byte_size_positive", sql`${t.byteSize} > 0`),
        check(
            "ck_receipts_status",
            sql`${t.status} in ('uploaded', 'parsing', 'parsed', 'applied', 'failed')`,
        ),
        check(
            "ck_receipts_total_price_non_negative",
            sql`${t.totalPrice} is null or ${t.totalPrice} >= 0`,
        ),
    ],
);

// AI が抽出したレシート明細 1 行と、その照合結果。承認前の下書きであり、
// この表の存在だけでは在庫は動かない。レシートを消せば行も消えるため cascade
export const receiptLines = sqliteTable(
    "receipt_lines",
    {
        id: text("id").primaryKey(),
        receiptId: text("receipt_id")
            .notNull()
            .references(() => receipts.id, { onDelete: "cascade" }),
        lineNo: integer("line_no").notNull(),
        // レシートに印字された表記そのまま
        rawName: text("raw_name").notNull(),
        // 印字が途切れていた場合の補完名。表記辞書の見出しは raw_name のままにするため、
        // 新規品目名の初期値としてだけ使う。補完が不要・不確かなら null
        completedName: text("completed_name"),
        // domain の normalizeReceiptName を通した照合キー
        normalizedName: text("normalized_name").notNull(),
        quantity: integer("quantity").notNull(),
        // その行の金額（円、整数、数量分の小計）
        price: integer("price"),
        printedExpiryDate: text("printed_expiry_date"),
        estimatedExpiryDate: text("estimated_expiry_date"),
        expirySource: text("expiry_source", {
            enum: receiptExpirySources,
        }).notNull(),
        expiryConfidence: text("expiry_confidence", {
            enum: receiptExpiryConfidences,
        }),
        expiryReason: text("expiry_reason"),
        // 照合先の品目。参照されている品目の削除は restrict で禁止する
        matchedItemId: text("matched_item_id").references(() => items.id, {
            onDelete: "restrict",
        }),
        // create_item の反映で使う品目 ID の先行予約。品目を作る前に書くため
        // FK を持てない（存在しない行を参照する）。再実行時はこの ID の品目を
        // 探して再利用し、同名の孤児品目が増えないようにする
        pendingItemId: text("pending_item_id"),
        // 在庫に置かない行（レジ袋・送料など）。既存行は 0 のままにして、
        // 解析済みレシートの確認画面の既定を後から変えない
        stockRelevant: integer("stock_relevant").notNull().default(0),
        // 解析時に既存カテゴリへ解決できた場合の ID。カテゴリ削除を妨げないよう
        // 外部キーは張らず、参照が切れた場合は確認画面で選び直す
        suggestedCategoryId: text("suggested_category_id"),
        // 解決できなかったとき何を返したか追えるよう、AI の回答も残す
        suggestedCategoryName: text("suggested_category_name"),
        suggestedBaseUnit: text("suggested_base_unit"),
        suggestedBaseDimension: text("suggested_base_dimension", {
            enum: unitDimensions,
        }),
        matchMethod: text("match_method", { enum: receiptMatchMethods }),
        // 類似度は 0-100 の整数。浮動小数を保存しない
        matchScore: integer("match_score"),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [
        // 同一レシート内の行番号重複を禁止しつつ、明細取得の索引も兼ねる
        uniqueIndex("uq_receipt_lines_receipt_line_no").on(
            t.receiptId,
            t.lineNo,
        ),
        check("ck_receipt_lines_line_no_positive", sql`${t.lineNo} >= 1`),
        check("ck_receipt_lines_quantity_positive", sql`${t.quantity} >= 1`),
        check(
            "ck_receipt_lines_price_non_negative",
            sql`${t.price} is null or ${t.price} >= 0`,
        ),
        check(
            "ck_receipt_lines_expiry_source",
            sql`${t.expirySource} in ('printed', 'estimated', 'unknown')`,
        ),
        check(
            "ck_receipt_lines_expiry_confidence",
            sql`${t.expiryConfidence} is null or ${t.expiryConfidence} in ('high', 'medium', 'low')`,
        ),
        // 期限の由来と値を食い違わせない。printed なのに印字が無い、unknown
        // なのに日付がある、といった行は「レシートの印字」と表示できないため
        // 保存も許さない（表示ラベルの根拠を DB 制約で保証する）
        check(
            "ck_receipt_lines_expiry_consistent",
            sql`(${t.expirySource} = 'printed'
                    and ${t.printedExpiryDate} is not null
                    and ${t.estimatedExpiryDate} is null
                    and ${t.expiryConfidence} is null
                    and ${t.expiryReason} is null)
                or (${t.expirySource} = 'estimated'
                    and ${t.printedExpiryDate} is null
                    and ${t.estimatedExpiryDate} is not null)
                or (${t.expirySource} = 'unknown'
                    and ${t.printedExpiryDate} is null
                    and ${t.estimatedExpiryDate} is null
                    and ${t.expiryConfidence} is null
                    and ${t.expiryReason} is null)`,
        ),
        check(
            "ck_receipt_lines_match_method",
            sql`${t.matchMethod} is null or ${t.matchMethod} in ('exact', 'alias', 'similarity', 'manual')`,
        ),
        check(
            "ck_receipt_lines_match_score_range",
            sql`${t.matchScore} is null or (${t.matchScore} >= 0 and ${t.matchScore} <= 100)`,
        ),
    ],
);

// レシート表記から品目への辞書。1 つの正規化表記は 1 品目にしか結び付かないため
// normalized_name は全体で unique とする。品目を消す前にエイリアスを消す運用にするため
// FK は restrict とする
export const itemAliases = sqliteTable(
    "item_aliases",
    {
        id: text("id").primaryKey(),
        itemId: text("item_id")
            .notNull()
            .references(() => items.id, { onDelete: "restrict" }),
        normalizedName: text("normalized_name").notNull(),
        // レシート上の元表記。利用者が辞書を読めるように残す
        displayName: text("display_name").notNull(),
        source: text("source", { enum: itemAliasSources }).notNull(),
        // 辞書は追加・削除のみで更新しないため updated_at を持たない
        createdAt: text("created_at").notNull(),
    },
    (t) => [
        uniqueIndex("uq_item_aliases_normalized_name").on(t.normalizedName),
        index("idx_item_aliases_item").on(t.itemId),
        check(
            "ck_item_aliases_source",
            sql`${t.source} in ('receipt', 'manual')`,
        ),
    ],
);
