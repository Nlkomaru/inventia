import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "inventia",
		compatibilityDate: "2026-08-07",
		compatibilityFlags: [
			"nodejs_compat",
		],
		entrypoint: "@tanstack/react-start/server-entry",
		previewUrls: true,
		observability: {
			enabled: true,
		},
		domains: [
			"inventia.nikomaru.dev",
		],
		env: {
			OPENROUTER_WORKSPACE_ID: bindings.text("656c4b87-d2ac-4bbe-b79c-c9d79c735536"),
			SETTINGS_ENCRYPTION_KEY: bindings.secret(),
			OPENROUTER_MANAGEMENT_KEY: bindings.secret(),
			DB: bindings.d1({
				name: "inventia",
				id: "c23f315b-0c9e-4e57-9caf-37ba3fb5a47d",
				dev: {
					remote: true,
				},
			}),
			RECEIPTS: bindings.r2({
				name: "inventia-receipts",
				dev: {
					remote: true,
				},
			}),
			VECTORIZE: bindings.vectorize({
				name: "inventia-items",
				dev: {
					remote: true,
				},
			}),
			VECTORIZE_STORES: bindings.vectorize({
				name: "inventia-stores",
				dev: {
					remote: true,
				},
			}),
		},
	},
});
