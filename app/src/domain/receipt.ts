import { z } from "zod";

// レシート画像の AI OCR 構造化出力の契約。describe はモデルへの抽出指示を兼ねる。
// 読み取れない項目は省略ではなく null を返させるため、任意項目は optional でなく
// nullable にする（構造化出力では全フィールド必須のプロバイダーがあるため）。
// 金額は円の整数、日時はレシート表記のままのタイムゾーンなし ISO 8601 とし、
// UTC への変換・商品照合・基準単位への正規化は service 層で行う。
// 期限関連フィールドは #13 のレシート取込パイプライン向けの契約であり、現時点で呼び出し元はない。

export const receiptOcrLineSchema = z.object({
    name: z
        .string()
        .min(1)
        .describe(
            "レシートに印字された商品名の表記そのまま。省略や正規化をしない",
        ),
    quantity: z.int().min(1).describe("購入個数。表記がない行は 1"),
    price: z
        .int()
        .min(0)
        .nullable()
        .describe(
            "その行の金額（円、整数、数量分の小計）。読み取れない場合は null",
        ),
    printedExpiryDate: z.iso
        .date()
        .nullable()
        .describe(
            "レシートに消費期限・賞味期限が印字されている稀なケースでのその値（タイムゾーンなしの ISO 8601 日付、例: 2026-04-15）。印字を読み取れた場合だけ設定し、推測値をここへ入れない。印字がなければ null",
        ),
    estimatedExpiryDate: z.iso
        .date()
        .nullable()
        .describe(
            "印字がない場合に購入日と商品種別（生鮮 / 冷蔵 / 冷凍 / 常温加工品 / 非食品）から推測した期限（タイムゾーンなしの ISO 8601 日付）。印字がある場合は null。非食品や期限の概念がない品も null。推測値は確認画面でユーザーが必ず修正・削除できる前提の参考値であり、商品種別を絞れず推測できない場合は必ず null とし、値を捏造しない",
        ),
    expirySource: z
        .enum(["printed", "estimated", "unknown"])
        .describe(
            "期限の由来。印字を読み取れた場合は printed、推測した場合は estimated、どちらもできない場合は unknown。unknown のときは printedExpiryDate と estimatedExpiryDate の両方を null にする",
        ),
    expiryConfidence: z
        .enum(["high", "medium", "low"])
        .nullable()
        .describe(
            "推測の確度。商品種別が明確で一般的な保存期間が定まるなら high、種別の推定に幅があるなら medium、商品名から種別をほとんど絞れないなら low。expirySource が printed または unknown のときは推測がないため null",
        ),
    expiryEstimateReason: z
        .string()
        .min(1)
        .nullable()
        .describe(
            "推測根拠の短い日本語（例: 「常温の小麦粉は購入から約 12 か月」）。expirySource が estimated のときだけ設定し、それ以外は null",
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
