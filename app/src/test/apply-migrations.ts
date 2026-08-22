import { applyD1Migrations, env } from "cloudflare:test";

// migration を適用した D1 をテストへ渡す。d1_migrations で適用済みを記録するため、
// テストファイルごとに実行しても二重適用にはならない
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
