import { z } from "zod";

/** The identifier format used by storage_locations. */
export const locationIdSchema = z.string().trim().min(1).max(128);

/** Names are normalized at the input boundary so sibling uniqueness is predictable. */
export const locationNameSchema = z
    .string()
    .trim()
    .min(1, "場所名は必須です")
    .max(200, "場所名は200文字以内で入力してください");

/** SQLite INTEGER is a signed 64-bit value; this narrower range is portable to API clients. */
export const locationSortOrderSchema = z
    .number()
    .int("並び順は整数で指定してください")
    .min(-2_147_483_648)
    .max(2_147_483_647);

export const locationCreateInputSchema = z
    .object({
        name: locationNameSchema,
        parentId: locationIdSchema.nullable().optional().default(null),
        sortOrder: locationSortOrderSchema.optional().default(0),
    })
    .strict();

export const locationUpdateInputSchema = z
    .object({
        name: locationNameSchema.optional(),
        parentId: locationIdSchema.nullable().optional(),
        sortOrder: locationSortOrderSchema.optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "更新する項目を1つ以上指定してください",
    });

/** 名前の部分一致検索語。空文字は絞り込みなしとして扱う。 */
export const locationSearchSchema = z.string().trim().max(200);

// 未知のキーは拒否する。綴りを誤った絞り込みが黙って無視されると、
// 呼び出し側は絞り込み済みだと思ったまま全件を受け取ってしまう
export const locationListInputSchema = z
    .object({
        parentId: locationIdSchema.nullable().default(null),
        // 指定した文字列を名前に含む場所だけに絞る（大文字小文字を区別しない部分一致）
        q: locationSearchSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        // 検索語を含む cursor は URI エンコードで数倍に伸びるため、上限は
        // 最長の検索語でも収まる長さにする
        cursor: z.string().trim().min(1).max(4096).optional(),
    })
    .strict();

export const locationCursorSchema = z
    .object({
        parentId: locationIdSchema.nullable(),
        // 検索条件も cursor のスコープに含め、別の条件で作られた cursor を拒否する。
        // 検索語を持たない旧 cursor は q なしで作られているため null として解釈する
        q: locationSearchSchema.nullable().default(null),
        sortOrder: locationSortOrderSchema,
        id: locationIdSchema,
    })
    .strict();

export const locationDtoSchema = z
    .object({
        id: locationIdSchema,
        name: locationNameSchema,
        parentId: locationIdSchema.nullable(),
        sortOrder: locationSortOrderSchema,
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export const locationListOutputSchema = z
    .object({
        items: z.array(locationDtoSchema),
        nextCursor: z.string().nullable(),
    })
    .strict();

// ツリーは階層ごとのページングをせず全件返すため、continuation ではなく
// 打ち切りの有無だけを返す。上限を超えた場合の続きは階層ごとの一覧で辿る
export const locationTreeOutputSchema = z
    .object({
        items: z.array(locationDtoSchema),
        truncated: z.boolean(),
    })
    .strict();

export const locationDeleteOutputSchema = z
    .object({ deleted: z.literal(true) })
    .strict();

export type LocationId = z.infer<typeof locationIdSchema>;
export type LocationCreateInput = z.infer<typeof locationCreateInputSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateInputSchema>;
export type LocationListInput = z.infer<typeof locationListInputSchema>;
export type LocationCursor = z.infer<typeof locationCursorSchema>;
export type LocationDto = z.infer<typeof locationDtoSchema>;

// btoa は Latin-1 しか扱えないため、非 ASCII の検索語を含む cursor は
// 先に URI エンコードする。旧 cursor の payload は ASCII のみで `%` を含まないため、
// 復号時の decodeURIComponent は旧 cursor に対して何もしない
const toBase64Url = (value: string): string =>
    btoa(encodeURIComponent(value))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/u, "");

const fromBase64Url = (value: string): string => {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    return decodeURIComponent(
        atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)),
    );
};

/** Cursors are opaque to clients while retaining the (sort_order, id) key. */
export const encodeLocationCursor = (cursor: LocationCursor): string =>
    toBase64Url(JSON.stringify(locationCursorSchema.parse(cursor)));

export const decodeLocationCursor = (cursor: string): LocationCursor | null => {
    try {
        const decoded = fromBase64Url(cursor);
        const parsed: unknown = JSON.parse(decoded);
        const result = locationCursorSchema.safeParse(parsed);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};

export const normalizeLocationCreateInput = (
    input: LocationCreateInput,
): LocationCreateInput => locationCreateInputSchema.parse(input);

export const normalizeLocationUpdateInput = (
    input: LocationUpdateInput,
): LocationUpdateInput => locationUpdateInputSchema.parse(input);
