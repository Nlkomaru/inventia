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
                bindings: { TEST_MIGRATIONS: migrations },
            },
        }),
    ],
    test: {
        include: ["src/**/*.test.ts"],
        setupFiles: ["./src/test/apply-migrations.ts"],
    },
});
