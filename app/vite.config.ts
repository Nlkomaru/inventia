import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const config = defineConfig(({ command, mode }) => {
    // remote binding の接続先 (*.workers.dev) が Cloudflare Access 配下のため、
    // wrangler が process.env から読む Access service token を .env から載せ替える。
    const fileEnv = loadEnv(mode, process.cwd(), "");
    for (const key of [
        "CLOUDFLARE_ACCESS_CLIENT_ID",
        "CLOUDFLARE_ACCESS_CLIENT_SECRET",
    ]) {
        if (!process.env[key] && fileEnv[key]) {
            process.env[key] = fileEnv[key];
        }
    }

    const accessClientId = process.env.CLOUDFLARE_ACCESS_CLIENT_ID;
    const accessClientSecret = process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET;
    const hasAccessServiceToken = Boolean(accessClientId && accessClientSecret);
    // 既定は remote D1 binding。INVENTIA_API_PROXY=1 のときだけ /api をデプロイ済み Worker へ委譲する。
    const proxyAccessProtectedWorker =
        command === "serve" &&
        process.env.INVENTIA_API_PROXY === "1" &&
        hasAccessServiceToken;

    return {
        resolve: { tsconfigPaths: true },
        server: proxyAccessProtectedWorker
            ? {
                  proxy: {
                      "/api": {
                          target: "https://inventia.nikomaru.dev",
                          changeOrigin: true,
                          headers: {
                              "CF-Access-Client-Id": accessClientId,
                              "CF-Access-Client-Secret": accessClientSecret,
                          },
                      },
                  },
              }
            : undefined,
        plugins: [
            devtools(),
            cloudflare({
                configPath: proxyAccessProtectedWorker
                    ? "./wrangler.local.jsonc"
                    : undefined,
                viteEnvironment: { name: "ssr" },
            }),
            tailwindcss(),
            tanstackStart(),
            viteReact(),
        ],
    };
});

export default config;
