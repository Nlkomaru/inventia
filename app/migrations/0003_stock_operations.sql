CREATE TABLE `stock_operations` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`delta` integer NOT NULL,
	`target_quantity` integer,
	`reason` text NOT NULL,
	`occurred_at` text NOT NULL,
	`occurred_at_provided` integer DEFAULT 0 NOT NULL,
	`movement_id` text,
	`resulting_quantity` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_stock_operations_kind" CHECK("stock_operations"."kind" in ('adjustment', 'stocktake')),
	CONSTRAINT "ck_stock_operations_reason" CHECK("stock_operations"."reason" in ('purchase', 'stocktake', 'consume', 'discard', 'other')),
	CONSTRAINT "ck_stock_operations_occurred_at_provided" CHECK("stock_operations"."occurred_at_provided" in (0, 1)),
	CONSTRAINT "ck_stock_operations_payload" CHECK(("stock_operations"."kind" = 'stocktake' and "stock_operations"."target_quantity" is not null) or ("stock_operations"."kind" = 'adjustment' and "stock_operations"."target_quantity" is null and "stock_operations"."delta" <> 0)),
	CONSTRAINT "ck_stock_operations_target_quantity_non_negative" CHECK("stock_operations"."target_quantity" is null or "stock_operations"."target_quantity" >= 0),
	CONSTRAINT "ck_stock_operations_resulting_quantity_non_negative" CHECK("stock_operations"."resulting_quantity" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_stock_operations_item_created` ON `stock_operations` (`item_id`,`created_at`,`idempotency_key`);--> statement-breakpoint
-- D1 does not allow toggling foreign_keys; defer checks while recreating the table.
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
	CONSTRAINT "ck_stock_movements_delta_not_zero" CHECK("__new_stock_movements"."delta" <> 0),
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
CREATE INDEX `idx_stock_movements_occurred` ON `stock_movements` (`occurred_at`,`id`);
