CREATE TABLE `external_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`favicon_url` text,
	`url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "ck_external_providers_name_not_empty" CHECK(length("external_providers"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_external_providers_name` ON `external_providers` (`name`);--> statement-breakpoint
ALTER TABLE `integration_settings` ADD `emoji_model` text DEFAULT 'deepseek/deepseek-v4-flash-0731' NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `emoji` text DEFAULT '📦' NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `note` text;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `external_provider_id` text REFERENCES external_providers(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `external_id` text;--> statement-breakpoint
CREATE INDEX `idx_stock_movements_external` ON `stock_movements` (`external_provider_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_price_records_recorded_at` ON `price_records` (`recorded_at`,`id`);