import { z } from "zod";

export const categoryIdSchema = z.string().trim().min(1).max(128);

export const categoryNameSchema = z
    .string()
    .trim()
    .min(1, "カテゴリ名は必須です")
    .max(200, "カテゴリ名は200文字以内で入力してください");

export const categoryKindSchema = z.enum([
    "daily_goods",
    "food",
    "book",
    "document",
]);

export const categorySortOrderSchema = z
    .number()
    .int("並び順は整数で指定してください")
    .min(-2_147_483_648)
    .max(2_147_483_647);

export const categoryCreateInputSchema = z
    .object({
        name: categoryNameSchema,
        parentId: categoryIdSchema.nullable().optional().default(null),
        // null は汎用カテゴリで、実効 kind は祖先を遡って解決する
        kind: categoryKindSchema.nullable().optional().default(null),
        sortOrder: categorySortOrderSchema.optional().default(0),
    })
    .strict();

export const categoryUpdateInputSchema = z
    .object({
        name: categoryNameSchema.optional(),
        parentId: categoryIdSchema.nullable().optional(),
        kind: categoryKindSchema.nullable().optional(),
        sortOrder: categorySortOrderSchema.optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "更新する項目を1つ以上指定してください",
    });

export const categoryListInputSchema = z.object({
    parentId: categoryIdSchema.nullable().default(null),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(512).optional(),
});

export const categoryCursorSchema = z
    .object({
        parentId: categoryIdSchema.nullable(),
        sortOrder: categorySortOrderSchema,
        id: categoryIdSchema,
    })
    .strict();

export const categoryDtoSchema = z
    .object({
        id: categoryIdSchema,
        name: categoryNameSchema,
        parentId: categoryIdSchema.nullable(),
        kind: categoryKindSchema.nullable(),
        sortOrder: categorySortOrderSchema,
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export const categoryListOutputSchema = z
    .object({
        items: z.array(categoryDtoSchema),
        nextCursor: z.string().nullable(),
    })
    .strict();

// ツリーは階層ごとのページングをせず全件返すため、continuation ではなく
// 打ち切りの有無だけを返す。上限を超えた場合の続きは階層ごとの一覧で辿る
export const categoryTreeOutputSchema = z
    .object({
        items: z.array(categoryDtoSchema),
        truncated: z.boolean(),
    })
    .strict();

export const categoryDeleteOutputSchema = z
    .object({ deleted: z.literal(true) })
    .strict();

export type CategoryId = z.infer<typeof categoryIdSchema>;
export type CategoryKind = z.infer<typeof categoryKindSchema>;
export type CategoryCreateInput = z.infer<typeof categoryCreateInputSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateInputSchema>;
export type CategoryListInput = z.infer<typeof categoryListInputSchema>;
export type CategoryCursor = z.infer<typeof categoryCursorSchema>;
export type CategoryDto = z.infer<typeof categoryDtoSchema>;

const toBase64Url = (value: string): string =>
    btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

const fromBase64Url = (value: string): string => {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
};

/** Cursors are opaque to clients while retaining the (sort_order, id) key. */
export const encodeCategoryCursor = (cursor: CategoryCursor): string =>
    toBase64Url(JSON.stringify(categoryCursorSchema.parse(cursor)));

export const decodeCategoryCursor = (cursor: string): CategoryCursor | null => {
    try {
        const decoded = fromBase64Url(cursor);
        const parsed: unknown = JSON.parse(decoded);
        const result = categoryCursorSchema.safeParse(parsed);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};
