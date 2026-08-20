import { z } from "zod";
import {
    itemLotDtoSchema,
    lotExpiryDateOutputSchema,
    lotExpiryDateSchema,
} from "./lot";
import { readingStateDtoSchema, readingStatusSchema } from "./reading";

export const itemBaseDimensionSchema = z.enum(["mass", "volume", "count"]);

/** 絵文字が決まっていない品目のプレースホルダ。AI 生成に失敗してもこの値で成立させる。 */
export const defaultItemEmoji = "📦";

/**
 * 絵文字 1 個だけを許す。文字数では判定できない（👩‍🍳 は 3 code point、
 * 🇯🇵 は 2 code point ある）ため、絵文字の並びとして受け付ける形を直接書く。
 *
 * - 国旗（Regional_Indicator 2 個）
 * - 絵文字 + 肌色修飾（\p{Emoji_Modifier}）
 * - 絵文字 + 異体字セレクタ（U+FE0F）
 * - ZWJ（U+200D）で連結した絵文字列（家族、レインボーフラッグなど）
 *
 * 数字のキーキャップ（1️⃣）のように絵文字以外から始まる並びは通さない。
 * DB は ALTER ADD COLUMN で CHECK を足せないため、この検証だけが妥当性の担保になる
 */
const itemEmojiPattern =
    /^(?:\p{RI}\p{RI}|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{RI}\p{RI}))*)$/u;

export const itemEmojiSchema = z
    .string()
    .trim()
    .min(1, "絵文字を入力してください")
    // ZWJ で連結した家族絵文字は 11 code unit になるため、1 個分の上限として 16 を取る
    .max(16, "絵文字は1文字だけ入力してください")
    .regex(itemEmojiPattern, "絵文字を1個だけ入力してください");

export const itemDtoSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    // 一覧で品目を見分けるための絵文字 1 個。未生成の品目は既定の 📦 が入る
    emoji: z.string(),
    categoryId: z.string(),
    locationId: z.string(),
    baseUnit: z.string(),
    baseDimension: itemBaseDimensionSchema,
    // ロット合計の維持キャッシュ。在庫の正は item_lots である
    currentQuantity: z.int().min(0),
    // 数量 > 0 のロットのうち最も早い期限。期限付きの在庫がなければ null
    earliestExpiryDate: lotExpiryDateOutputSchema,
    // 数量 > 0 のロット件数。内訳表示の有無の判定に使う
    lotCount: z.int().min(0),
    lowStockThreshold: z.int().min(0).nullable(),
    memo: z.string().nullable(),
    // 保存済みの読書状態。読書状態は書籍カテゴリーの品目だけが持つため、
    // 書籍以外と未設定はどちらも null になる
    readingStatus: readingStatusSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

// 詳細取得では期限別の内訳を同梱する（数量 0 のロットは含めない）
export const itemDetailDtoSchema = itemDtoSchema.extend({
    lots: z.array(itemLotDtoSchema),
    // readingStatus と同じ行から導く、開始日・読了日まで含めた読書状態
    readingState: readingStateDtoSchema.nullable(),
});

// 書籍カテゴリーの品目と読書状態の一覧行。一覧のためロット内訳は含めない
export const bookReadingItemDtoSchema = itemDtoSchema.extend({
    readingState: readingStateDtoSchema.nullable(),
});

export const bookReadingListDtoSchema = z.object({
    items: z.array(bookReadingItemDtoSchema),
    nextCursor: z.string().nullable(),
});

const itemFields = {
    name: z.string().trim().min(1).max(200),
    categoryId: z.string().trim().min(1),
    locationId: z.string().trim().min(1),
    baseUnit: z.string().trim().min(1).max(50),
    baseDimension: itemBaseDimensionSchema,
    currentQuantity: z.int().min(0),
    // 作成時の初期ロットの期限。以後の期限変更はロット単位の操作で行う
    expiryDate: lotExpiryDateSchema,
    lowStockThreshold: z.int().min(0).nullable(),
    memo: z.string().max(2000).nullable(),
};

export const itemCreateSchema = z
    .object({
        name: itemFields.name,
        categoryId: itemFields.categoryId,
        locationId: itemFields.locationId,
        baseUnit: itemFields.baseUnit.optional(),
        baseDimension: itemFields.baseDimension.optional(),
        currentQuantity: itemFields.currentQuantity.optional(),
        expiryDate: itemFields.expiryDate.optional(),
        lowStockThreshold: itemFields.lowStockThreshold.optional(),
        memo: itemFields.memo.optional(),
        // 省略時は品目名から AI が生成する。生成に失敗しても品目作成は成立させる
        emoji: itemEmojiSchema.optional(),
    })
    .strict()
    .refine(
        (value) =>
            (value.baseUnit === undefined) ===
            (value.baseDimension === undefined),
        {
            message: "baseUnit and baseDimension must be provided together",
            path: ["baseDimension"],
        },
    );

export const itemUpdateSchema = z
    .object({
        name: itemFields.name.optional(),
        categoryId: itemFields.categoryId.optional(),
        locationId: itemFields.locationId.optional(),
        // 基準単位と次元の変更は換算を伴わない「つけ替え」で、保存済みの数量の
        // 数値（items.current_quantity、ロット、入出庫履歴、価格の内容量）は
        // どれも書き換えない。同じ数値のまま意味だけが変わるため、在庫や履歴を
        // 持つ品目では呼び出し側が利用者へ警告し、了解を得てから送ること
        baseUnit: itemFields.baseUnit.optional(),
        baseDimension: itemFields.baseDimension.optional(),
        lowStockThreshold: itemFields.lowStockThreshold.optional(),
        memo: itemFields.memo.optional(),
        emoji: itemEmojiSchema.optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "at least one field is required",
    })
    // 次元だけを差し替えると、単位の表記が前の次元のまま残る（体積へ移したのに
    // 単位は g、など）。作成時に両方を対で受け取るのと揃えて、次元を変えるときは
    // 単位も指定させる。同じ次元での表記直し（単位だけの変更）は許す
    .refine(
        (value) =>
            value.baseDimension === undefined || value.baseUnit !== undefined,
        {
            message: "baseUnit is required when baseDimension changes",
            path: ["baseUnit"],
        },
    );

// 未知のキーは拒否する。綴りを誤った絞り込みが黙って無視されると、
// 呼び出し側は絞り込み済みだと思ったまま全件を受け取ってしまう
export const itemListQuerySchema = z
    .object({
        q: z.string().trim().max(200).optional(),
        categoryId: z.string().trim().min(1).optional(),
        locationId: z.string().trim().min(1).optional(),
        lowStockOnly: z
            .preprocess(
                (value) =>
                    value === "true" || value === "1"
                        ? true
                        : value === "false" || value === "0"
                          ? false
                          : value,
                z.boolean(),
            )
            .optional(),
        // 数量 > 0 のロットの期限が now + n 日以内の品目だけに絞る。
        // 期限なしロットは対象外で、既に期限を過ぎたロットは常に該当する
        expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
        // 指定した読書状態が保存されている品目だけに絞る。読書状態を持たない品目は
        // どの値にも一致しない（未設定を unread とみなさない）
        readingStatus: readingStatusSchema.optional(),
        // 並び順。expiry は期限が早い順（期限なしは最後）で、期限の近い在庫を
        // 先頭のページで答えられるようにする。既定は従来どおり名前順
        sort: z.enum(["name", "expiry"]).default("name"),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).optional(),
    })
    .strict();

// 品目名の意味検索の入力。HTTP のクエリ文字列と MCP の JSON 入力の両方から使うため、
// topK は文字列・数値のどちらで来ても z.coerce で受ける
export const itemSemanticSearchQuerySchema = z
    .object({
        q: z.string().trim().min(1).max(200),
        topK: z.coerce.number().int().min(1).max(100).default(20),
    })
    .strict();

// cursor を持たない。Vectorize の query は cursor を提供せず、topK で打ち切る仕様のため
export const itemSemanticSearchResultSchema = z.object({
    items: z.array(itemDtoSchema),
});

// 名前の一括照合。1 行ずつ検索させると呼び出し回数が行数に比例するため、
// レシートの明細のような複数の表記をまとめて受ける。
// cursor を持たない: 入力ごとに 1 件の結果を返す形で、続きの概念がない
export const itemNameMatchNamesMax = 50;
export const itemNameMatchCandidateLimitMax = 5;

export const itemNameMatchInputSchema = z
    .object({
        names: z
            .array(z.string().trim().min(1).max(200))
            .min(1)
            .max(itemNameMatchNamesMax),
        candidateLimit: z.coerce
            .number()
            .int()
            .min(0)
            .max(itemNameMatchCandidateLimitMax)
            .default(itemNameMatchCandidateLimitMax),
    })
    .strict();

export const itemNameMatchCandidateSchema = z
    .object({
        itemId: z.string().min(1),
        name: z.string().min(1),
        score: z.int().min(0).max(100),
    })
    .strict();

export const itemNameMatchResultSchema = z
    .object({
        // 問い合わせた表記そのまま。呼び出し側が入力と突き合わせられるようにする
        query: z.string(),
        // 照合キーへ正規化した表記。空になる表記はどの品目とも一致しない
        normalizedQuery: z.string(),
        itemId: z.string().nullable(),
        method: z.enum(["exact", "alias"]).nullable(),
        score: z.int().min(0).max(100).nullable(),
        // 類似度だけでは確定させないため、確定した表記では空配列になる
        candidates: z.array(itemNameMatchCandidateSchema),
    })
    .strict();

export const itemNameMatchOutputSchema = z
    .object({
        results: z.array(itemNameMatchResultSchema),
        // 照合の母集合が上限で切れたかどうか。true のときは一致しない表記が
        // 「存在しない」ことの根拠にならない
        poolTruncated: z.boolean(),
    })
    .strict();

export type ItemNameMatchInput = z.infer<typeof itemNameMatchInputSchema>;
export type ItemNameMatchResult = z.infer<typeof itemNameMatchResultSchema>;
export type ItemNameMatchOutput = z.infer<typeof itemNameMatchOutputSchema>;

// id の一括読み取り。1 件ずつ引くと呼び出し回数が id の数に比例するため、
// まとめて受ける。上限は D1 の bind 上限（100）に収まる値で、読書状態の
// 一括取得が 1 つの IN 句を作るためこれ以上には広げられない
export const itemBatchIdsMax = 90;

export const itemBatchInputSchema = z
    .object({
        ids: z.array(z.string().trim().min(1)).min(1).max(itemBatchIdsMax),
        // ロットは品目あたりの件数に上限が無いため、要約だけ欲しい場合に落とせる
        includeLots: z.boolean().default(true),
    })
    .strict();

export const itemBatchOutputSchema = z
    .object({
        items: z.array(itemDetailDtoSchema),
        // 見つからなかった id。1 件の欠落で全体を失わせない
        notFound: z.array(z.string()),
    })
    .strict();

export type ItemBatchInput = z.infer<typeof itemBatchInputSchema>;
export type ItemBatchOutput = z.infer<typeof itemBatchOutputSchema>;

export type ItemCreateInput = z.infer<typeof itemCreateSchema>;
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;
export type ItemListQuery = z.infer<typeof itemListQuerySchema>;
export type ItemSemanticSearchQuery = z.infer<
    typeof itemSemanticSearchQuerySchema
>;
export type ItemSemanticSearchResult = z.infer<
    typeof itemSemanticSearchResultSchema
>;

export type ItemBaseDimension = z.infer<typeof itemBaseDimensionSchema>;
export type ItemDto = z.infer<typeof itemDtoSchema>;
export type ItemDetailDto = z.infer<typeof itemDetailDtoSchema>;
export type BookReadingItemDto = z.infer<typeof bookReadingItemDtoSchema>;
export type BookReadingListDto = z.infer<typeof bookReadingListDtoSchema>;
