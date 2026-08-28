CREATE TABLE `stock_movement_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`movement_id` text NOT NULL,
	`before_note` text,
	`after_note` text,
	`corrected_at` text NOT NULL,
	FOREIGN KEY (`movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_stock_movement_revisions_movement` ON `stock_movement_revisions` (`movement_id`,`corrected_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER `trg_stock_movements_note_revision`
AFTER UPDATE OF `note` ON `stock_movements`
FOR EACH ROW
WHEN OLD.`note` IS NOT NEW.`note`
BEGIN
	INSERT INTO `stock_movement_revisions` (
		`movement_id`,
		`before_note`,
		`after_note`,
		`corrected_at`
	) VALUES (
		NEW.`id`,
		OLD.`note`,
		NEW.`note`,
		strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
	);
END;