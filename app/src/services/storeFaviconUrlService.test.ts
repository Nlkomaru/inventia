import { describe, expect, it } from "vitest";
import {
    isSignedStoreFaviconRequest,
    signStoreFaviconUrl,
} from "./storeFaviconUrlService";

const env = { SETTINGS_ENCRYPTION_KEY: "test-secret" };
const origin = "https://inventia.test";
const storeId = "01a01d79-5960-77f9-97a1-27bf6656b773";
const now = Date.UTC(2026, 8, 16, 12, 0, 0);

const request = (url: string, method = "GET") => ({ method, url });

describe("signStoreFaviconUrl", () => {
    it("同じ日のうちは同じ URL を返し、翌日は変わる", () => {
        const first = signStoreFaviconUrl(env, storeId, now);
        const later = signStoreFaviconUrl(env, storeId, now + 3_600_000);
        const nextDay = signStoreFaviconUrl(env, storeId, now + 86_400_000);

        expect(first).toMatch(/^\/api\/stores\/.+\/favicon\?exp=\d+&sig=.+$/u);
        expect(later).toBe(first);
        expect(nextDay).not.toBe(first);
    });

    it("署名した URL の GET を通す", () => {
        const url = signStoreFaviconUrl(env, storeId, now);

        expect(
            isSignedStoreFaviconRequest(env, request(origin + url), now),
        ).toBe(true);
        // キャッシュ用の余分な query は署名の対象外なので付いていても通る
        expect(
            isSignedStoreFaviconRequest(
                env,
                request(`${origin}${url}&v=1`),
                now,
            ),
        ).toBe(true);
    });

    it("期限切れ、改竄、別の店舗 ID、別の鍵の署名は通さない", () => {
        const url = signStoreFaviconUrl(env, storeId, now);
        const expired = now + 9 * 86_400_000;
        const tampered = url.replace(
            /sig=(.)/u,
            (_, c: string) => `sig=${c === "A" ? "B" : "A"}`,
        );
        const otherStore = url.replace(storeId, "other-store");

        expect(
            isSignedStoreFaviconRequest(env, request(origin + url), expired),
        ).toBe(false);
        expect(
            isSignedStoreFaviconRequest(env, request(origin + tampered), now),
        ).toBe(false);
        expect(
            isSignedStoreFaviconRequest(env, request(origin + otherStore), now),
        ).toBe(false);
        expect(
            isSignedStoreFaviconRequest(
                { SETTINGS_ENCRYPTION_KEY: "another" },
                request(origin + url),
                now,
            ),
        ).toBe(false);
    });

    it("署名が無い、または別のパスの要求は通さない", () => {
        expect(
            isSignedStoreFaviconRequest(
                env,
                request(`${origin}/api/stores/${storeId}/favicon`),
                now,
            ),
        ).toBe(false);
        expect(
            isSignedStoreFaviconRequest(
                env,
                request(`${origin}/api/stores/${storeId}`),
                now,
            ),
        ).toBe(false);
    });

    it("署名があっても PUT と DELETE は通さない", () => {
        const url = signStoreFaviconUrl(env, storeId, now);

        for (const method of ["PUT", "DELETE", "POST"]) {
            expect(
                isSignedStoreFaviconRequest(
                    env,
                    request(origin + url, method),
                    now,
                ),
            ).toBe(false);
        }
    });
});
