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
    // 既定は remote D1 binding。INVENTIA_API_PROXY=1 のときはローカル D1 の Worker 設定を使う。
    // Cloudflare plugin は build 時点の wrangler 設定を dist/server/wrangler.json へ焼き込むため、
    // command で絞ると `vite preview` が常に remote D1 を指してしまう。
    // Access service token は remote 接続先 (Access 配下) のためのもので、ローカル設定には不要。
    const useLocalWorkerConfig = process.env.INVENTIA_API_PROXY === "1";
    // /api をデプロイ済み Worker へ委譲する proxy は dev server だけの機能で、token が要る。
    const proxyAccessProtectedWorker =
        command === "serve" && useLocalWorkerConfig && hasAccessServiceToken;

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
                configPath: useLocalWorkerConfig
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
