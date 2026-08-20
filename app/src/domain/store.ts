import { z } from "zod";

/** The identifier format used by stores. */
export const storeIdSchema = z.string().trim().min(1).max(128);

export const storeNameMaxLength = 200;

/** Names are normalized at the input boundary so uniqueness is predictable. */
export const storeNameSchema = z
    .string()
    .trim()
    .min(1, "店名は必須です")
    .max(storeNameMaxLength, "店名は200文字以内で入力してください");

export const storeUrlSchema = z.url().max(2048);

/**
 * ファビコンとして受け付ける形式。SVG は同一オリジンで配信すると
 * 保存型 XSS になるため受け付けない。
 */
export const storeFaviconContentTypes = [
    "image/png",
    "image/jpeg",
    "image/webp",
] as const;
export const storeFaviconContentTypeSchema = z.enum(storeFaviconContentTypes);

export type StoreFaviconContentType = z.infer<
    typeof storeFaviconContentTypeSchema
>;

export const storeFaviconContentTypeExtensions = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
} as const satisfies Record<StoreFaviconContentType, string>;

/** ファビコンの上限サイズ（1 MiB）。表示用の小さな画像しか置かせない。 */
export const storeFaviconMaxByteSize = 1_048_576;

export const storeCreateInputSchema = z
    .object({
        name: storeNameSchema,
        url: storeUrlSchema.nullable().optional().default(null),
    })
    .strict();

export const storeUpdateInputSchema = z
    .object({
        name: storeNameSchema.optional(),
        url: storeUrlSchema.nullable().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "更新する項目を1つ以上指定してください",
    });

/** 店名の部分一致検索語。空文字は絞り込みなしとして扱う。 */
export const storeSearchSchema = z.string().trim().max(200);

// 未知のキーは拒否する。綴りを誤った絞り込みが黙って無視されると、
// 呼び出し側は絞り込み済みだと思ったまま全件を受け取ってしまう
export const storeListInputSchema = z
    .object({
        // 指定した文字列を店名に含む店舗だけに絞る（大文字小文字を区別しない部分一致）
        q: storeSearchSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        // cursor は q と店名を含み、日本語 1 文字が URI エンコードで 9 文字へ
        // 伸びる。どちらも最大長だと base64url 後に約 5,100 文字となるため、
        // 自分が発行した cursor を拒否しない上限にする
        cursor: z.string().trim().min(1).max(8192).optional(),
    })
    .strict();

export const storeCursorSchema = z
    .object({
        // 検索条件も cursor のスコープに含め、別の条件で作られた cursor を拒否する
        q: storeSearchSchema.nullable(),
        name: storeNameSchema,
        id: storeIdSchema,
    })
    .strict();

export const storeDtoSchema = z
    .object({
        id: storeIdSchema,
        name: storeNameSchema,
        url: z.url().nullable(),
        // ファビコンがあるときだけ /api/stores/{id}/favicon を返す。URL は保存しない
        faviconUrl: z.string().nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict();

export const storeListOutputSchema = z
    .object({
        items: z.array(storeDtoSchema),
        nextCursor: z.string().nullable(),
    })
    .strict();

export const storeDeleteOutputSchema = z
    .object({ deleted: z.literal(true) })
    .strict();

export type StoreId = z.infer<typeof storeIdSchema>;
export type StoreCreateInput = z.infer<typeof storeCreateInputSchema>;
export type StoreUpdateInput = z.infer<typeof storeUpdateInputSchema>;
export type StoreListInput = z.infer<typeof storeListInputSchema>;
export type StoreCursor = z.infer<typeof storeCursorSchema>;
export type StoreDto = z.infer<typeof storeDtoSchema>;

/** ファビコンの配信パス。R2 のオブジェクトキーは公開しない。 */
export const storeFaviconPath = (id: string): string =>
    `/api/stores/${encodeURIComponent(id)}/favicon`;

// btoa は Latin-1 しか扱えないため、日本語の店名を含む cursor は
// 先に URI エンコードする
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

/** Cursors are opaque to clients while retaining the (name, id) key. */
export const encodeStoreCursor = (cursor: StoreCursor): string =>
    toBase64Url(JSON.stringify(storeCursorSchema.parse(cursor)));

/** Returns null rather than leaking malformed cursor errors to transport code. */
export const decodeStoreCursor = (cursor: string): StoreCursor | null => {
    try {
        const decoded = fromBase64Url(cursor);
        const parsed: unknown = JSON.parse(decoded);
        const result = storeCursorSchema.safeParse(parsed);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};
