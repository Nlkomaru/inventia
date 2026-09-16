import { describe, expect, it } from "vitest";
import { receiptImagePath } from "../domain/receipt";
import { storeFaviconPath } from "../domain/store";
import { isSignedImageRequest, signImageUrl } from "./signedImageUrlService";

const env = { SETTINGS_ENCRYPTION_KEY: "test-secret" };
const origin = "https://inventia.test";
const faviconPath = storeFaviconPath("01a01d79-5960-77f9-97a1-27bf6656b773");
const imagePath = receiptImagePath("01a01d79-0000-77f9-97a1-27bf6656b773");
const now = Date.UTC(2026, 8, 16, 12, 0, 0);

const request = (url: string, method = "GET") => ({ method, url });

describe("signImageUrl", () => {
    it("同じ日のうちは同じ URL を返し、翌日は変わる", () => {
        const first = signImageUrl(env, faviconPath, now);
        const later = signImageUrl(env, faviconPath, now + 3_600_000);
        const nextDay = signImageUrl(env, faviconPath, now + 86_400_000);

        expect(first).toMatch(/^\/api\/stores\/.+\/favicon\?exp=\d+&sig=.+$/u);
        expect(later).toBe(first);
        expect(nextDay).not.toBe(first);
    });

    it("店舗ファビコンとレシート画像の署名した URL の GET を通す", () => {
        for (const path of [faviconPath, imagePath]) {
            const url = signImageUrl(env, path, now);

            expect(isSignedImageRequest(env, request(origin + url), now)).toBe(
                true,
            );
            // キャッシュ用の余分な query は署名の対象外なので付いていても通る
            expect(
                isSignedImageRequest(env, request(`${origin}${url}&v=1`), now),
            ).toBe(true);
        }
    });

    it("期限切れ、改竄、別のパスへの流用、別の鍵の署名は通さない", () => {
        const url = signImageUrl(env, faviconPath, now);
        const expired = now + 9 * 86_400_000;
        const tampered = url.replace(
            /sig=(.)/u,
            (_, c: string) => `sig=${c === "A" ? "B" : "A"}`,
        );
        const reused = url.replace(faviconPath, storeFaviconPath("other"));

        expect(isSignedImageRequest(env, request(origin + url), expired)).toBe(
            false,
        );
        expect(isSignedImageRequest(env, request(origin + tampered), now)).toBe(
            false,
        );
        expect(isSignedImageRequest(env, request(origin + reused), now)).toBe(
            false,
        );
        expect(
            isSignedImageRequest(
                { SETTINGS_ENCRYPTION_KEY: "another" },
                request(origin + url),
                now,
            ),
        ).toBe(false);
    });

    it("署名が無い要求と、画像以外のパスは署名があっても通さない", () => {
        const signedStore = signImageUrl(env, "/api/stores/x", now);

        expect(
            isSignedImageRequest(env, request(origin + faviconPath), now),
        ).toBe(false);
        expect(
            isSignedImageRequest(env, request(origin + signedStore), now),
        ).toBe(false);
    });

    it("署名があっても PUT と DELETE は通さない", () => {
        const url = signImageUrl(env, imagePath, now);

        for (const method of ["PUT", "DELETE", "POST"]) {
            expect(
                isSignedImageRequest(env, request(origin + url, method), now),
            ).toBe(false);
        }
    });
});
