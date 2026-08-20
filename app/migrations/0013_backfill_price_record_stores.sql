-- 既存の価格履歴が持つ自由記述の取得元（source）を店舗マスタへ移し、store_id を埋める。
-- 同じ名前の行は 1 つの店舗へ集約し、同名の店舗が既にあればそれを再利用する。
-- source 列は残すため、店舗と結び付かなかった行の表示は変わらない。

-- 主キーは他のテーブルと同じ UUIDv7 の形にする。先頭 48 bit は生成時刻（ミリ秒）、
-- version は 7、variant は 8〜b で、残りは SQLite の CSPRNG である randomblob から取る。
INSERT INTO `stores`
	(`id`, `name`, `url`, `favicon_object_key`, `favicon_content_type`,
	 `favicon_byte_size`, `created_at`, `updated_at`)
SELECT
	lower(
		substr(printf('%012x', CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1, 8) || '-' ||
		substr(printf('%012x', CAST(strftime('%s', 'now') AS INTEGER) * 1000), 9, 4) || '-7' ||
		substr(hex(randomblob(2)), 2, 3) || '-' ||
		substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2, 3) || '-' ||
		hex(randomblob(6))
	),
	`distinct_source`.`name`,
	NULL,
	NULL,
	NULL,
	NULL,
	strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
	strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
	SELECT DISTINCT trim(`source`) AS `name`
	FROM `price_records`
	WHERE `store_id` IS NULL AND length(trim(`source`)) > 0
) AS `distinct_source`
WHERE NOT EXISTS (
	SELECT 1 FROM `stores` AS `s` WHERE `s`.`name` = `distinct_source`.`name`
);--> statement-breakpoint
-- 名前の突き合わせは uq_stores_name と同じ既定の照合順序で行う。
-- 対応する店舗が無い行（source が空白のみなど）は store_id を NULL のまま残す。
UPDATE `price_records`
SET `store_id` = (
	SELECT `s`.`id` FROM `stores` AS `s`
	WHERE `s`.`name` = trim(`price_records`.`source`)
)
WHERE `store_id` IS NULL
	AND EXISTS (
		SELECT 1 FROM `stores` AS `s`
		WHERE `s`.`name` = trim(`price_records`.`source`)
	);
