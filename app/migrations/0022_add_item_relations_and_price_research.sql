CREATE TABLE `item_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_item_id` text NOT NULL,
	`child_item_id` text NOT NULL,
	`label` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_item_relations_not_self" CHECK("item_relations"."parent_item_id" <> "item_relations"."child_item_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_item_relations_child` ON `item_relations` (`child_item_id`);--> statement-breakpoint
CREATE INDEX `idx_item_relations_parent` ON `item_relations` (`parent_item_id`);--> statement-breakpoint
CREATE TABLE `price_research_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`item_id` text,
	`requested_item_name` text NOT NULL,
	`requested_unit` text,
	`purpose` text,
	`note` text,
	`requested_by` text,
	`price_record_id` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`price_record_id`) REFERENCES `price_records`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_price_research_requests_status" CHECK("price_research_requests"."status" in ('pending', 'completed', 'cancelled')),
	CONSTRAINT "ck_price_research_requests_name_not_empty" CHECK(length("price_research_requests"."requested_item_name") > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_price_research_requests_status_created` ON `price_research_requests` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_price_research_requests_item` ON `price_research_requests` (`item_id`);