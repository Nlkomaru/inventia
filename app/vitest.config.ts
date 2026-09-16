import { fileURLToPath } from "node:url";
import {
    cloudflareTest,
    readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// テストは wrangler.jsonc を読まない。本番の D1 / R2 / Vectorize は remote 指定で、
// 読み込むとテストが本番のリソースへ接続してしまうため、必要な binding だけをここで組む
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
    plugins: [
        cloudflareTest({
            miniflare: {
                compatibilityDate: "2026-08-07",
                compatibilityFlags: ["nodejs_compat"],
                d1Databases: ["DB"],
                // 店舗ファビコンの保管先。ローカルの R2 emulation なので本番へは触れない
                r2Buckets: ["RECEIPTS"],
                bindings: {
                    TEST_MIGRATIONS: migrations,
                    // 店舗ファビコン URL の署名鍵の元。テスト用の固定値で秘密ではない
                    SETTINGS_ENCRYPTION_KEY: "inventia-test-settings-key",
                },
            },
        }),
    ],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        include: ["src/**/*.test.ts"],
        setupFiles: ["./src/test/apply-migrations.ts"],
    },
});
