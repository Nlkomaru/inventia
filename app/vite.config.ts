import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const accessClientId = process.env.CLOUDFLARE_ACCESS_CLIENT_ID;
const accessClientSecret = process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET;
const hasAccessServiceToken = Boolean(accessClientId && accessClientSecret);

const config = defineConfig(({ command }) => {
	const proxyAccessProtectedWorker =
		command === "serve" && hasAccessServiceToken;

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
