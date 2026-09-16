import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * API が配信する画像（店舗ファビコン、レシート写真）の署名付き URL。
 *
 * /api/* は API トークンが必須だが、ブラウザの <img> は Authorization ヘッダーを
 * 付けられない。そこで画像の GET だけは、URL に載せた署名で通す。署名は配信パスと
 * 有効期限を SETTINGS_ENCRYPTION_KEY から派生させた鍵で HMAC したもので、R2 の
 * オブジェクトキーや秘密そのものは URL に含めない。
 */

export interface SignedImageUrlEnv {
    SETTINGS_ENCRYPTION_KEY: string;
}

/** 署名で通してよい画像の配信パス。ここに無いパスは署名があっても通さない。 */
const signedImagePathPatterns: readonly RegExp[] = [
    /^\/api\/stores\/[^/]+\/favicon$/u,
    /^\/api\/receipts\/[^/]+\/image$/u,
];

const daySeconds = 86_400;

/** 発行日の UTC 0 時から数えて何日先を有効期限にするか。 */
const validityDays = 8;

// 暗号化にも使う鍵をそのまま署名鍵にせず、用途ラベルで派生させる
const deriveSigningKey = (secret: string): Buffer =>
    createHmac("sha256", secret).update("inventia/signed-image-url").digest();

const sign = (secret: string, path: string, exp: number): string =>
    createHmac("sha256", deriveSigningKey(secret))
        .update(`${path}\n${exp}`)
        .digest("base64url");

/**
 * 有効期限は呼び出しごとではなく UTC の日付単位で丸める。同じ日の間は同じ URL に
 * なるので、一覧の再取得やブラウザのキャッシュで URL が揺れず、長く開いたままの
 * 画面でも 1 週間は切れない。
 */
const expiresAt = (nowMs: number): number =>
    (Math.floor(nowMs / 1000 / daySeconds) + validityDays) * daySeconds;

/** 配信パス（query を含まない）に署名を付けて返す。 */
export const signImageUrl = (
    env: SignedImageUrlEnv,
    path: string,
    nowMs: number = Date.now(),
): string => {
    const exp = expiresAt(nowMs);
    const query = new URLSearchParams({
        exp: String(exp),
        sig: sign(env.SETTINGS_ENCRYPTION_KEY, path, exp),
    });
    return `${path}?${query.toString()}`;
};

/**
 * 署名付きの画像 GET かどうか。書き込み（PUT / DELETE）は署名があっても通さない。
 * 署名は発行時のパス文字列そのものに対して検証するため、余分な query は影響しない。
 * 比較は長さを揃えた上で timingSafeEqual で行う。
 */
export const isSignedImageRequest = (
    env: SignedImageUrlEnv,
    request: { method: string; url: string },
    nowMs: number = Date.now(),
): boolean => {
    if (request.method !== "GET" && request.method !== "HEAD") {
        return false;
    }
    const url = new URL(request.url);
    if (
        !signedImagePathPatterns.some((pattern) => pattern.test(url.pathname))
    ) {
        return false;
    }
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig") ?? "";
    if (!Number.isSafeInteger(exp) || exp * 1000 <= nowMs) {
        return false;
    }
    const expected = Buffer.from(
        sign(env.SETTINGS_ENCRYPTION_KEY, url.pathname, exp),
        "utf8",
    );
    const actual = Buffer.from(sig, "utf8");
    return (
        actual.byteLength === expected.byteLength &&
        timingSafeEqual(actual, expected)
    );
};
