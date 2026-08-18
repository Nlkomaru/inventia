ALTER TABLE `receipt_lines` ADD `stock_relevant` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `receipt_lines` ADD `suggested_category_id` text;--> statement-breakpoint
ALTER TABLE `receipt_lines` ADD `suggested_base_unit` text;--> statement-breakpoint
ALTER TABLE `receipt_lines` ADD `suggested_base_dimension` text;