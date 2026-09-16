import { createHmac, timingSafeEqual } from "node:crypto";
import { storeFaviconPath } from "../domain/store";

/**
 * 店舗ファビコンの署名付き URL。
 *
 * /api/* は API トークンが必須だが、ブラウザの <img> は Authorization ヘッダーを
 * 付けられない。そこで画像の GET だけは、URL に載せた署名で通す。署名は店舗 ID と
 * 有効期限を SETTINGS_ENCRYPTION_KEY から派生させた鍵で HMAC したもので、R2 の
 * オブジェクトキーや秘密そのものは URL に含めない。
 */

export interface StoreFaviconUrlEnv {
    SETTINGS_ENCRYPTION_KEY: string;
}

const daySeconds = 86_400;

/** 発行日の UTC 0 時から数えて何日先を有効期限にするか。 */
const validityDays = 8;

// 暗号化にも使う鍵をそのまま署名鍵にせず、用途ラベルで派生させる
const deriveSigningKey = (secret: string): Buffer =>
    createHmac("sha256", secret).update("inventia/store-favicon-url").digest();

const sign = (secret: string, id: string, exp: number): string =>
    createHmac("sha256", deriveSigningKey(secret))
        .update(`${id}\n${exp}`)
        .digest("base64url");

/**
 * 有効期限は呼び出しごとではなく UTC の日付単位で丸める。同じ日の間は同じ URL に
 * なるので、一覧の再取得やブラウザのキャッシュで URL が揺れず、長く開いたままの
 * 画面でも 1 週間は切れない。
 */
const expiresAt = (nowMs: number): number =>
    (Math.floor(nowMs / 1000 / daySeconds) + validityDays) * daySeconds;

export const signStoreFaviconUrl = (
    env: StoreFaviconUrlEnv,
    id: string,
    nowMs: number = Date.now(),
): string => {
    const exp = expiresAt(nowMs);
    const query = new URLSearchParams({
        exp: String(exp),
        sig: sign(env.SETTINGS_ENCRYPTION_KEY, id, exp),
    });
    return `${storeFaviconPath(id)}?${query.toString()}`;
};

const faviconPathPattern = /^\/api\/stores\/([^/]+)\/favicon$/u;

/**
 * 署名付きの画像 GET かどうか。書き込み（PUT / DELETE）は署名があっても通さない。
 * 署名の比較は長さを揃えた上で timingSafeEqual で行う。
 */
export const isSignedStoreFaviconRequest = (
    env: StoreFaviconUrlEnv,
    request: { method: string; url: string },
    nowMs: number = Date.now(),
): boolean => {
    if (request.method !== "GET" && request.method !== "HEAD") {
        return false;
    }
    const url = new URL(request.url);
    const match = faviconPathPattern.exec(url.pathname);
    if (!match?.[1]) {
        return false;
    }
    let id: string;
    try {
        id = decodeURIComponent(match[1]);
    } catch {
        return false;
    }
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig") ?? "";
    if (!Number.isSafeInteger(exp) || exp * 1000 <= nowMs) {
        return false;
    }
    const expected = Buffer.from(
        sign(env.SETTINGS_ENCRYPTION_KEY, id, exp),
        "utf8",
    );
    const actual = Buffer.from(sig, "utf8");
    return (
        actual.byteLength === expected.byteLength &&
        timingSafeEqual(actual, expected)
    );
};
