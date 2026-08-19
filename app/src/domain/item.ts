import { z } from "zod";
import {
    itemLotDtoSchema,
    lotExpiryDateOutputSchema,
    lotExpiryDateSchema,
} from "./lot";
import { readingStateDtoSchema, readingStatusSchema } from "./reading";

export const itemBaseDimensionSchema = z.enum(["mass", "volume", "count"]);

export const itemDtoSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
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
        lowStockThreshold: itemFields.lowStockThreshold.optional(),
        memo: itemFields.memo.optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "at least one field is required",
    });

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
