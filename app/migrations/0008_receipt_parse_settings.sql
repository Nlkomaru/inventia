ALTER TABLE `integration_settings` ADD `receipt_prompt` text;--> statement-breakpoint
ALTER TABLE `integration_settings` ADD `receipt_tools_enabled` integer DEFAULT 0 NOT NULL;