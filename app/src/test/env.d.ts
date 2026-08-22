/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare namespace Cloudflare {
    interface Env {
        // vitest.config.ts が読み込んだ migration を binding として渡す
        TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
}
