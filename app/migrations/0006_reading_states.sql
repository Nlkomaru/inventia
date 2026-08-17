CREATE TABLE `item_reading_states` (
	`item_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_item_reading_states_status" CHECK("item_reading_states"."status" in ('unread', 'reading', 'finished')),
	CONSTRAINT "ck_item_reading_states_unread_dates" CHECK("item_reading_states"."status" <> 'unread' or ("item_reading_states"."started_at" is null and "item_reading_states"."finished_at" is null)),
	CONSTRAINT "ck_item_reading_states_reading_dates" CHECK("item_reading_states"."status" <> 'reading' or "item_reading_states"."finished_at" is null),
	CONSTRAINT "ck_item_reading_states_date_order" CHECK("item_reading_states"."started_at" is null or "item_reading_states"."finished_at" is null or "item_reading_states"."finished_at" >= "item_reading_states"."started_at")
);
--> statement-breakpoint
CREATE INDEX `idx_item_reading_states_status` ON `item_reading_states` (`status`,`item_id`);