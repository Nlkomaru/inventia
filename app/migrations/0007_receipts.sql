CREATE TABLE `item_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`normalized_name` text NOT NULL,
	`display_name` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_item_aliases_source" CHECK("item_aliases"."source" in ('receipt', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_item_aliases_normalized_name` ON `item_aliases` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_item_aliases_item` ON `item_aliases` (`item_id`);--> statement-breakpoint
CREATE TABLE `receipt_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`raw_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`quantity` integer NOT NULL,
	`price` integer,
	`printed_expiry_date` text,
	`estimated_expiry_date` text,
	`expiry_source` text NOT NULL,
	`expiry_confidence` text,
	`expiry_reason` text,
	`matched_item_id` text,
	`pending_item_id` text,
	`match_method` text,
	`match_score` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matched_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_receipt_lines_line_no_positive" CHECK("receipt_lines"."line_no" >= 1),
	CONSTRAINT "ck_receipt_lines_quantity_positive" CHECK("receipt_lines"."quantity" >= 1),
	CONSTRAINT "ck_receipt_lines_price_non_negative" CHECK("receipt_lines"."price" is null or "receipt_lines"."price" >= 0),
	CONSTRAINT "ck_receipt_lines_expiry_source" CHECK("receipt_lines"."expiry_source" in ('printed', 'estimated', 'unknown')),
	CONSTRAINT "ck_receipt_lines_expiry_confidence" CHECK("receipt_lines"."expiry_confidence" is null or "receipt_lines"."expiry_confidence" in ('high', 'medium', 'low')),
	CONSTRAINT "ck_receipt_lines_expiry_consistent" CHECK(("receipt_lines"."expiry_source" = 'printed'
                    and "receipt_lines"."printed_expiry_date" is not null
                    and "receipt_lines"."estimated_expiry_date" is null
                    and "receipt_lines"."expiry_confidence" is null
                    and "receipt_lines"."expiry_reason" is null)
                or ("receipt_lines"."expiry_source" = 'estimated'
                    and "receipt_lines"."printed_expiry_date" is null
                    and "receipt_lines"."estimated_expiry_date" is not null)
                or ("receipt_lines"."expiry_source" = 'unknown'
                    and "receipt_lines"."printed_expiry_date" is null
                    and "receipt_lines"."estimated_expiry_date" is null
                    and "receipt_lines"."expiry_confidence" is null
                    and "receipt_lines"."expiry_reason" is null)),
	CONSTRAINT "ck_receipt_lines_match_method" CHECK("receipt_lines"."match_method" is null or "receipt_lines"."match_method" in ('exact', 'alias', 'similarity', 'manual')),
	CONSTRAINT "ck_receipt_lines_match_score_range" CHECK("receipt_lines"."match_score" is null or ("receipt_lines"."match_score" >= 0 and "receipt_lines"."match_score" <= 100))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_receipt_lines_receipt_line_no` ON `receipt_lines` (`receipt_id`,`line_no`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`status` text NOT NULL,
	`store_name` text,
	`purchased_at` text,
	`total_price` integer,
	`model` text,
	`error_message` text,
	`purchase_id` text,
	`applied_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_receipts_byte_size_positive" CHECK("receipts"."byte_size" > 0),
	CONSTRAINT "ck_receipts_status" CHECK("receipts"."status" in ('uploaded', 'parsing', 'parsed', 'applied', 'failed')),
	CONSTRAINT "ck_receipts_total_price_non_negative" CHECK("receipts"."total_price" is null or "receipts"."total_price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_receipts_object_key` ON `receipts` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_receipts_created_at` ON `receipts` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_receipts_status` ON `receipts` (`status`);