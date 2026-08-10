import { z } from "zod";

// レシート画像の AI OCR 構造化出力の契約。describe はモデルへの抽出指示を兼ねる。
// 読み取れない項目は省略ではなく null を返させるため、任意項目は optional でなく
// nullable にする（構造化出力では全フィールド必須のプロバイダーがあるため）。
// 金額は円の整数、日時はレシート表記のままのタイムゾーンなし ISO 8601 とし、
// UTC への変換・商品照合・基準単位への正規化は service 層で行う。

export const receiptOcrLineSchema = z.object({
	name: z
		.string()
		.min(1)
		.describe("レシートに印字された商品名の表記そのまま。省略や正規化をしない"),
	quantity: z.int().min(1).describe("購入個数。表記がない行は 1"),
	price: z
		.int()
		.min(0)
		.nullable()
		.describe(
			"その行の金額（円、整数、数量分の小計）。読み取れない場合は null",
		),
});

export const receiptOcrResultSchema = z.object({
	storeName: z
		.string()
		.min(1)
		.nullable()
		.describe("購入店舗名。読み取れない場合は null"),
	purchasedAt: z.iso
		.datetime({ local: true })
		.nullable()
		.describe(
			"レシート記載の購入日時（タイムゾーンなしの ISO 8601、例: 2026-04-01T19:23:00）。時刻が読み取れない場合は 00:00:00、日付も読み取れない場合は null",
		),
	totalPrice: z
		.int()
		.min(0)
		.nullable()
		.describe(
			"レシート記載の合計金額（円、整数）。明細合計との照合に使う。読み取れない場合は null",
		),
	lines: z
		.array(receiptOcrLineSchema)
		.min(1)
		.describe("商品明細。値引き行や小計・預り金の行は含めない"),
});

export type ReceiptOcrLine = z.infer<typeof receiptOcrLineSchema>;
export type ReceiptOcrResult = z.infer<typeof receiptOcrResultSchema>;
