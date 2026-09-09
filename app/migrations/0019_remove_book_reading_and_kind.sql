-- 書籍機能の撤去: 読書状態テーブルの削除と、カテゴリ種別 CHECK からの 'book' 除去。
-- drizzle-kit の生成 SQL に対して、(1) PRAGMA foreign_keys を D1 で実行できる
-- defer_foreign_keys へ置換、(2) 再構築前に種別 book のルートカテゴリ(書籍)の
-- 削除を追加している。新しい CHECK は 'book' を許可しないため、コピー時点で
-- 行が残っていると INSERT が CHECK 違反になる。
-- D1 は PRAGMA foreign_keys を実行できないため、テーブル再作成時は defer_foreign_keys を使う。
DROP TABLE `item_reading_states`;--> statement-breakpoint
-- 0001 が投入したルートカテゴリ「書籍」(kind = 'book') を再構築前に削除する。
-- 新しい ck_categories_kind は 'book' を許可しないため、コピー時点で行が残っていると
-- INSERT が CHECK 違反になる。書籍はこの在庫システムでは管理しなくなるため、
-- カテゴリ・品目とも残さない。
-- 子カテゴリや品目が存在すると FK restrict によりここで失敗する（存在してはいけない状態）
DELETE FROM `categories` WHERE `id` = '019fdcef-ee16-70fb-a3a0-60eb24f472fd';--> statement-breakpoint
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`kind` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_categories_kind" CHECK("__new_categories"."kind" is null or "__new_categories"."kind" in ('daily_goods', 'food', 'document')),
	CONSTRAINT "ck_categories_name_not_empty" CHECK(length("__new_categories"."name") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_categories`("id", "name", "parent_id", "kind", "sort_order", "created_at", "updated_at") SELECT "id", "name", "parent_id", "kind", "sort_order", "created_at", "updated_at" FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_categories_parent_name` ON `categories` (`parent_id`,`name`);