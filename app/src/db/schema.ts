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
		check("ck_storage_locations_name_not_empty", sql`length(${t.name}) > 0`),
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
		baseDimension: text("base_dimension", { enum: unitDimensions }).notNull(),
		// 基準単位での現在在庫。stock_movements の追加と同一トランザクションで原子的に更新する
		currentQuantity: integer("current_quantity").notNull().default(0),
		// 商品単位の任意期限日 1 つ（ISO 8601 UTC）。ロット単位の期限は対象外
		expiryDate: text("expiry_date"),
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
			.references(() => items.id, { onDelete: "cascade" }),
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
		uniqueIndex("uq_stock_movements_purchase_item").on(t.purchaseId, t.itemId),
		// 履歴一覧の cursor paging 用。(occurred_at, id) で順序を一意に安定させる
		index("idx_stock_movements_item_occurred").on(t.itemId, t.occurredAt, t.id),
		check("ck_stock_movements_delta_not_zero", sql`${t.delta} <> 0`),
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
		index("idx_price_records_item_recorded").on(t.itemId, t.recordedAt, t.id),
		index("idx_price_records_source").on(t.source),
		// 購入 → 明細の逆引き用
		index("idx_price_records_purchase").on(t.purchaseId),
		check(
			"ck_price_records_content_amount_positive",
			sql`${t.contentAmount} > 0`,
		),
		check("ck_price_records_set_count_positive", sql`${t.setCount} >= 1`),
		check("ck_price_records_price_non_negative", sql`${t.price} >= 0`),
		check("ck_price_records_source_not_empty", sql`length(${t.source}) > 0`),
	],
);
