-- D1 は PRAGMA foreign_keys を実行できないため、テーブル再作成時は defer_foreign_keys を使う。
-- drizzle-kit の生成 SQL はこの点と、旧テーブルに存在しない列の SELECT を手修正している。
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`purchased_at` text NOT NULL,
	`note` text,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	CONSTRAINT "ck_purchases_source_not_empty" CHECK(length("purchases"."source") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_purchases_idempotency_key` ON `purchases` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_purchases_purchased_at` ON `purchases` (`purchased_at`,`id`);--> statement-breakpoint
ALTER TABLE `price_records` ADD `purchase_id` text REFERENCES purchases(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `idx_price_records_purchase` ON `price_records` (`purchase_id`);--> statement-breakpoint
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
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_stock_movements_delta_not_zero" CHECK("__new_stock_movements"."delta" <> 0),
	CONSTRAINT "ck_stock_movements_purchase_reason" CHECK("__new_stock_movements"."purchase_id" is null or "__new_stock_movements"."reason" = 'purchase'),
	CONSTRAINT "ck_stock_movements_reason" CHECK("__new_stock_movements"."reason" in ('purchase', 'stocktake', 'consume', 'discard', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_stock_movements`("id", "item_id", "delta", "reason", "purchase_id", "occurred_at", "idempotency_key", "created_at") SELECT "id", "item_id", "delta", "reason", NULL, "occurred_at", "idempotency_key", "created_at" FROM `stock_movements`;--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
ALTER TABLE `__new_stock_movements` RENAME TO `stock_movements`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_movements_idempotency_key` ON `stock_movements` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_movements_purchase_item` ON `stock_movements` (`purchase_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_item_occurred` ON `stock_movements` (`item_id`,`occurred_at`,`id`);