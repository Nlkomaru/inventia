CREATE TABLE `mcp_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`mcp_tool_id` text NOT NULL,
	`called_at` text NOT NULL,
	FOREIGN KEY (`mcp_tool_id`) REFERENCES `mcp_tools`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_mcp_tool_calls_tool_called` ON `mcp_tool_calls` (`mcp_tool_id`,`called_at`);--> statement-breakpoint
CREATE INDEX `idx_mcp_tool_calls_called` ON `mcp_tool_calls` (`called_at`,`id`);--> statement-breakpoint
CREATE TABLE `mcp_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mcp_tools_name` ON `mcp_tools` (`name`);