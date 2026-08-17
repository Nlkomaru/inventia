-- 期限別ロットの導入。items.expiry_date を item_lots へ移し、items.current_quantity は
-- ロット合計から再計算するキャッシュに変わる。
-- drizzle-kit の生成 SQL に対して、(1) PRAGMA foreign_keys を D1 で実行できる
-- defer_foreign_keys へ置換、(2) stock_movements 再構築を子テーブル作成より前へ移動、
-- (3) backfill の追加、(4) backfill 後に items.expiry_date を DROP する順序、を手修正している。
-- D1 は PRAGMA foreign_keys を実行できないため、テーブル再作成時は defer_foreign_keys を使う。
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`purchase_id` text,
	`occurred_at` text NOT NULL,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_stock_movements_delta_not_zero" CHECK("__new_stock_movements"."delta" <> 0 or "__new_stock_movements"."reason" = 'stocktake'),
	CONSTRAINT "ck_stock_movements_purchase_reason" CHECK("__new_stock_movements"."purchase_id" is null or "__new_stock_movements"."reason" = 'purchase'),
	CONSTRAINT "ck_stock_movements_reason" CHECK("__new_stock_movements"."reason" in ('purchase', 'stocktake', 'consume', 'discard', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_stock_movements`("id", "item_id", "delta", "reason", "purchase_id", "occurred_at", "idempotency_key", "created_at") SELECT "id", "item_id", "delta", "reason", "purchase_id", "occurred_at", "idempotency_key", "created_at" FROM `stock_movements`;--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
ALTER TABLE `__new_stock_movements` RENAME TO `stock_movements`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_movements_idempotency_key` ON `stock_movements` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_movements_purchase_item` ON `stock_movements` (`purchase_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_item_occurred` ON `stock_movements` (`item_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_occurred` ON `stock_movements` (`occurred_at`,`id`);--> statement-breakpoint
CREATE TABLE `integration_settings` (
	`provider` text PRIMARY KEY NOT NULL,
	`chat_model` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "ck_integration_settings_provider" CHECK("integration_settings"."provider" = 'openrouter'),
	CONSTRAINT "ck_integration_settings_chat_model_not_empty" CHECK(length("integration_settings"."chat_model") > 0)
);
--> statement-breakpoint
CREATE TABLE `item_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`expiry_date` text,
	`quantity` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_item_lots_quantity_non_negative" CHECK("item_lots"."quantity" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_item_lots_item_expiry` ON `item_lots` (`item_id`,`expiry_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_item_lots_item_no_expiry` ON `item_lots` (`item_id`) WHERE "item_lots"."expiry_date" is null;--> statement-breakpoint
CREATE INDEX `idx_item_lots_expiry` ON `item_lots` (`expiry_date`,`item_id`);--> statement-breakpoint
CREATE TABLE `stock_movement_lot_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`movement_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`expiry_date` text,
	`delta` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lot_id`) REFERENCES `item_lots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_stock_movement_lot_allocations_delta_not_zero" CHECK("stock_movement_lot_allocations"."delta" <> 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_movement_lot_allocations_movement_lot` ON `stock_movement_lot_allocations` (`movement_id`,`lot_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movement_lot_allocations_lot` ON `stock_movement_lot_allocations` (`lot_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `stock_operations` ADD `request_digest` text;--> statement-breakpoint
-- 既存在庫のロットへの移行。current_quantity > 0 または expiry_date あり の item に
-- 1 ロットだけ作り、合計数量を変えない。両方空の item はロットを作らない。
-- id は UUIDv7 を SQLite で生成できないため乱数 hex 32 桁で代替する（他 id と衝突しない形式）。
-- created_at / updated_at は移行時刻を持たず items の値を引き継ぐ（適用結果を決定的にするため）。
INSERT INTO `item_lots` ("id", "item_id", "expiry_date", "quantity", "created_at", "updated_at") SELECT lower(hex(randomblob(16))), "id", "expiry_date", "current_quantity", "created_at", "updated_at" FROM `items` WHERE "current_quantity" > 0 or "expiry_date" is not null;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `expiry_date`;
