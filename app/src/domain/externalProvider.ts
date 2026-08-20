import { z } from "zod";

/** The identifier format used by external providers. */
export const externalProviderIdSchema = z.string().trim().min(1).max(128);

export const externalProviderNameMaxLength = 100;

/** 名前は入力の境界で正規化し、一意性の判定を予測可能にする。 */
export const externalProviderNameSchema = z
    .string()
    .trim()
    .min(1, "連携先の名前は必須です")
    .max(
        externalProviderNameMaxLength,
        "連携先の名前は100文字以内で入力してください",
    );

/**
 * ファビコンとサイトの URL。画像は保管せず URL だけを持つ。
 * この値は画面で `href` と `<img src>` にそのまま入るため、スクリプトを実行できる
 * `javascript:` や `data:` を境界で弾き、http / https だけを受け付ける。
 */
export const externalProviderUrlSchema = z
    .url({
        protocol: /^https?$/,
        error: "http または https の URL を入力してください",
    })
    .max(2048, "URL は2048文字以内で入力してください");

export const externalProviderCreateInputSchema = z
    .object({
        name: externalProviderNameSchema,
        faviconUrl: externalProviderUrlSchema
            .nullable()
            .optional()
            .default(null),
        url: externalProviderUrlSchema.nullable().optional().default(null),
    })
    .strict();

// 部分更新。null は「消去する」、undefined は「今回は変更しない」を表すため、
// 両者を区別できる形にする
export const externalProviderUpdateInputSchema = z
    .object({
        name: externalProviderNameSchema.optional(),
        faviconUrl: externalProviderUrlSchema.nullable().optional(),
        url: externalProviderUrlSchema.nullable().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "更新する項目を1つ以上指定してください",
    });

export const externalProviderDtoSchema = z
    .object({
        id: externalProviderIdSchema,
        name: externalProviderNameSchema,
        faviconUrl: externalProviderUrlSchema.nullable(),
        url: externalProviderUrlSchema.nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .strict();

// 連携先はマスタとして件数が限られるため cursor を持たない。
// 上限は repositories 側の limit で抑える
export const externalProviderListSchema = z
    .object({
        providers: z.array(externalProviderDtoSchema),
    })
    .strict();

export const externalProviderDeleteOutputSchema = z
    .object({ deleted: z.literal(true) })
    .strict();

export type ExternalProviderId = z.infer<typeof externalProviderIdSchema>;
export type ExternalProviderCreateInput = z.infer<
    typeof externalProviderCreateInputSchema
>;
export type ExternalProviderUpdateInput = z.infer<
    typeof externalProviderUpdateInputSchema
>;
export type ExternalProviderDto = z.infer<typeof externalProviderDtoSchema>;
export type ExternalProviderList = z.infer<typeof externalProviderListSchema>;
