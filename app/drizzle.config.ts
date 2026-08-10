import { defineConfig } from "drizzle-kit";

// migration の生成のみ drizzle-kit で行い、適用は wrangler d1 migrations apply を使用する
export default defineConfig({
	dialect: "sqlite",
	schema: "./src/db/schema.ts",
	out: "./migrations",
});
