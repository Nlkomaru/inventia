import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const config = defineConfig(({ mode }) => {
    // binding は dev でも remote へ接続する。接続先 (*.workers.dev) が Cloudflare Access
    // 配下のため、wrangler が process.env から読む Access service token を .env から載せ替える。
    const fileEnv = loadEnv(mode, process.cwd(), "");
    for (const key of [
        "CLOUDFLARE_ACCESS_CLIENT_ID",
        "CLOUDFLARE_ACCESS_CLIENT_SECRET",
    ]) {
        if (!process.env[key] && fileEnv[key]) {
            process.env[key] = fileEnv[key];
        }
    }

    return {
        resolve: { tsconfigPaths: true },
        plugins: [
            devtools(),
            cloudflare({
                viteEnvironment: { name: "ssr" },
            }),
            tailwindcss(),
            tanstackStart(),
            viteReact(),
        ],
    };
});

export default config;
