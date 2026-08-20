CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`favicon_object_key` text,
	`favicon_content_type` text,
	`favicon_byte_size` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "ck_stores_name_not_empty" CHECK(length("stores"."name") > 0),
	CONSTRAINT "ck_stores_favicon_byte_size_positive" CHECK("stores"."favicon_byte_size" is null or "stores"."favicon_byte_size" > 0),
	CONSTRAINT "ck_stores_favicon_columns_consistent" CHECK(("stores"."favicon_object_key" is null and "stores"."favicon_content_type" is null and "stores"."favicon_byte_size" is null)
                or ("stores"."favicon_object_key" is not null and "stores"."favicon_content_type" is not null and "stores"."favicon_byte_size" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stores_name` ON `stores` (`name`);--> statement-breakpoint
ALTER TABLE `price_records` ADD `store_id` text REFERENCES stores(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `idx_price_records_store` ON `price_records` (`store_id`);