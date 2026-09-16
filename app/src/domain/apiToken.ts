import { z } from "zod";

/**
 * 外部のツールや MCP クライアントから HTTP API を呼ぶためのトークン。
 *
 * 値そのものは保存せず、発行時に一度だけ返す。DB には SHA-256 のハッシュと、
 * 一覧で見分けるための先頭 12 文字だけを持つ。
 */

/** 発行するトークンの接頭辞。どのサービス向けの資格情報か一目で分かるようにする */
export const apiTokenSecretPrefix = "inv_";

/** 32 バイトの乱数を base64url で表した本文の長さ */
const apiTokenSecretBodyLength = 43;

/** 発行したトークンを一覧で見分けるために残す先頭の長さ */
export const apiTokenPrefixLength = 12;

export const apiTokenSecretSchema = z
    .string()
    .startsWith(apiTokenSecretPrefix, "トークンの形式が正しくありません。")
    .length(
        apiTokenSecretPrefix.length + apiTokenSecretBodyLength,
        "トークンの形式が正しくありません。",
    );

export const apiTokenCreateSchema = z
    .object({
        name: z.string().trim().min(1).max(100),
    })
    .strict();

export const apiTokenSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    tokenPrefix: z.string(),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
});

export type ApiToken = z.output<typeof apiTokenSchema>;

export interface IssuedApiToken {
    /** 一覧に載るトークンの情報 */
    readonly token: ApiToken;
    /** 発行時にだけ返すトークン本体。DB には保存しない */
    readonly secret: string;
}
