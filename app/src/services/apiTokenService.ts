import {
    type ApiToken,
    apiTokenCreateSchema,
    apiTokenPrefixLength,
    apiTokenSecretPrefix,
    type IssuedApiToken,
} from "../domain/apiToken";
import { newId } from "../domain/id";
import {
    findApiTokenByHash,
    findApiTokenById,
    insertApiToken,
    listApiTokens,
    revokeApiTokenById,
    touchApiTokenUsedAt,
} from "../repositories/apiTokenRepository";

/**
 * API トークンの発行・失効・検証。
 *
 * トークンは 32 バイトの乱数で、DB には SHA-256 のハッシュだけを保存する。
 * ハッシュは十分に長い乱数に対する一方向関数なので、総当たりの心配はない。
 */

export type ApiTokenServiceErrorCode =
    | "API_TOKEN_INVALID_INPUT"
    | "API_TOKEN_NOT_FOUND"
    | "API_TOKEN_ALREADY_REVOKED";

const statusByCode: Record<ApiTokenServiceErrorCode, 400 | 404 | 409> = {
    API_TOKEN_INVALID_INPUT: 400,
    API_TOKEN_NOT_FOUND: 404,
    API_TOKEN_ALREADY_REVOKED: 409,
};

export class ApiTokenServiceError extends Error {
    readonly code: ApiTokenServiceErrorCode;
    readonly status: 400 | 404 | 409;

    constructor(code: ApiTokenServiceErrorCode, message: string) {
        super(message);
        this.name = "ApiTokenServiceError";
        this.code = code;
        this.status = statusByCode[code];
    }
}

const tokenSecretBodyBytes = 32;

/** 発行したトークンを毎回書き換えないための間隔 */
export const apiTokenUsageRefreshMs = 5 * 60 * 1000;

const toBase64Url = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");

/** URL のクエリやシェルに貼っても壊れない文字だけでトークンを作る */
const generateTokenSecret = (): string => {
    const bytes = new Uint8Array(tokenSecretBodyBytes);
    crypto.getRandomValues(bytes);
    return `${apiTokenSecretPrefix}${toBase64Url(bytes)}`;
};

const hashTokenSecret = async (secret: string): Promise<string> => {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(secret),
    );
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};

export const listApiTokenRecords = async (
    db: D1Database,
): Promise<ApiToken[]> => listApiTokens(db);

/** トークンを発行する。本体は戻り値にだけ含め、DB には残さない */
export const createApiToken = async (
    db: D1Database,
    input: unknown,
    now: string = new Date().toISOString(),
): Promise<IssuedApiToken> => {
    const parsed = apiTokenCreateSchema.safeParse(input);
    if (!parsed.success) {
        throw new ApiTokenServiceError(
            "API_TOKEN_INVALID_INPUT",
            parsed.error.issues.map((issue) => issue.message).join(" / ") ||
                "名前を入力してください。",
        );
    }

    const secret = generateTokenSecret();
    const token: ApiToken = {
        id: newId(),
        name: parsed.data.name,
        tokenPrefix: secret.slice(0, apiTokenPrefixLength),
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
    };
    await insertApiToken(db, {
        ...token,
        tokenHash: await hashTokenSecret(secret),
    });
    return { token, secret };
};

/** 失効させる。行は残し、一覧で履歴として見せる */
export const revokeApiToken = async (
    db: D1Database,
    id: string,
    now: string = new Date().toISOString(),
): Promise<ApiToken> => {
    const token = await findApiTokenById(db, id);
    if (!token) {
        throw new ApiTokenServiceError(
            "API_TOKEN_NOT_FOUND",
            "トークンが見つかりません。",
        );
    }
    if (token.revokedAt !== null) {
        throw new ApiTokenServiceError(
            "API_TOKEN_ALREADY_REVOKED",
            "このトークンはすでに失効しています。",
        );
    }
    await revokeApiTokenById(db, id, now);
    return { ...token, revokedAt: now };
};

/**
 * リクエストのトークンを検証する。失効済み・未登録なら null。
 * 最終使用時刻は書き込みを減らすため一定間隔でだけ更新する。
 */
export const authenticateApiToken = async (
    db: D1Database,
    secret: string,
    now: string = new Date().toISOString(),
): Promise<ApiToken | null> => {
    const trimmed = secret.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const row = await findApiTokenByHash(db, await hashTokenSecret(trimmed));
    if (!row || row.revokedAt !== null) {
        return null;
    }
    const lastUsed =
        row.lastUsedAt === null ? null : Date.parse(row.lastUsedAt);
    if (
        lastUsed === null ||
        Date.parse(now) - lastUsed >= apiTokenUsageRefreshMs
    ) {
        await touchApiTokenUsedAt(db, row.id, now);
        return { ...row, lastUsedAt: now };
    }
    return row;
};
