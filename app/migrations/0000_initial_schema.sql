CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`kind` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_categories_kind" CHECK("categories"."kind" is null or "categories"."kind" in ('daily_goods', 'food', 'book', 'document')),
	CONSTRAINT "ck_categories_name_not_empty" CHECK(length("categories"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_categories_parent_name` ON `categories` (`parent_id`,`name`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category_id` text NOT NULL,
	`location_id` text NOT NULL,
	`base_unit` text NOT NULL,
	`base_dimension` text NOT NULL,
	`current_quantity` integer DEFAULT 0 NOT NULL,
	`expiry_date` text,
	`low_stock_threshold` integer,
	`memo` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `storage_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_items_base_dimension" CHECK("items"."base_dimension" in ('mass', 'volume', 'count')),
	CONSTRAINT "ck_items_current_quantity_non_negative" CHECK("items"."current_quantity" >= 0),
	CONSTRAINT "ck_items_low_stock_threshold_non_negative" CHECK("items"."low_stock_threshold" is null or "items"."low_stock_threshold" >= 0),
	CONSTRAINT "ck_items_name_not_empty" CHECK(length("items"."name") > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_items_location` ON `items` (`location_id`);--> statement-breakpoint
CREATE INDEX `idx_items_category` ON `items` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_items_name` ON `items` (`name`);--> statement-breakpoint
CREATE TABLE `price_records` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`content_amount` integer NOT NULL,
	`set_count` integer DEFAULT 1 NOT NULL,
	`packaging` text,
	`price` integer NOT NULL,
	`source` text NOT NULL,
	`url` text,
	`recorded_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_price_records_content_amount_positive" CHECK("price_records"."content_amount" > 0),
	CONSTRAINT "ck_price_records_set_count_positive" CHECK("price_records"."set_count" >= 1),
	CONSTRAINT "ck_price_records_price_non_negative" CHECK("price_records"."price" >= 0),
	CONSTRAINT "ck_price_records_source_not_empty" CHECK(length("price_records"."source") > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_price_records_item_recorded` ON `price_records` (`item_id`,`recorded_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_price_records_source` ON `price_records` (`source`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`occurred_at` text NOT NULL,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_stock_movements_delta_not_zero" CHECK("stock_movements"."delta" <> 0),
	CONSTRAINT "ck_stock_movements_reason" CHECK("stock_movements"."reason" in ('purchase', 'stocktake', 'consume', 'discard', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_movements_idempotency_key` ON `stock_movements` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_item_occurred` ON `stock_movements` (`item_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE TABLE `storage_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `storage_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_storage_locations_name_not_empty" CHECK(length("storage_locations"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_storage_locations_parent_name` ON `storage_locations` (`parent_id`,`name`);