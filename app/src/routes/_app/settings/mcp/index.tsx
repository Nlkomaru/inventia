"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiTokenSecretSchema } from "@/domain/apiToken";

export const Route = createFileRoute("/_app/settings/mcp/")({
    staticData: {
        breadcrumbs: [{ label: "MCP エンドポイント" }],
    },
    component: McpSettingsPage,
});

const mcpEndpointUrl = "https://inventia.nikomaru.dev/api/mcp";
const credentialSchema = z
    .string()
    .max(4096, "4096 文字以内で入力してください。")
    .regex(/^[^\r\n]*$/, "改行は入力できません。");

function McpSettingsPage() {
    const [apiToken, setApiToken] = useState("");
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");
    const apiTokenResult = apiToken.trim()
        ? apiTokenSecretSchema.safeParse(apiToken.trim())
        : null;
    const clientIdResult = credentialSchema.safeParse(clientId);
    const clientSecretResult = credentialSchema.safeParse(clientSecret);
    const tokenCommand = createHermesTokenCommand(
        apiTokenResult?.success ? apiTokenResult.data : "<API トークン>",
    );
    const accessCommand = createHermesAccessCommand({
        clientId: clientIdResult.success && clientId ? clientId : "<CLIENT_ID>",
        clientSecret:
            clientSecretResult.success && clientSecret
                ? clientSecret
                : "<CLIENT_SECRET>",
    });

    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <header>
                <h1 className="mt-1 text-2xl font-bold">MCP 設定</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    MCP は HTTP API と同じく API
                    トークンで認証します。トークンは「API
                    トークン」の画面で発行し、使わなくなったら失効させてください。
                </p>
            </header>

            <section aria-labelledby="api-token-title">
                <div className="mb-5 flex items-center gap-3">
                    <h2 className="font-bold" id="api-token-title">
                        API トークンを使う
                    </h2>
                </div>
                <div className="flex flex-col gap-6">
                    <FieldGroup>
                        <Field data-invalid={apiTokenResult?.success === false}>
                            <FieldLabel htmlFor="mcp-api-token">
                                API トークン
                            </FieldLabel>
                            <Input
                                aria-invalid={apiTokenResult?.success === false}
                                autoComplete="off"
                                id="mcp-api-token"
                                onChange={(event) =>
                                    setApiToken(event.target.value)
                                }
                                placeholder="inv_…"
                                spellCheck={false}
                                type="password"
                                value={apiToken}
                            />
                            <FieldDescription>
                                入力値はこの画面内でコマンド生成にのみ使用されます。
                            </FieldDescription>
                            <FieldError
                                errors={
                                    apiTokenResult?.success === false
                                        ? apiTokenResult.error.issues
                                        : undefined
                                }
                            />
                        </Field>
                    </FieldGroup>

                    <div className="flex flex-col gap-2">
                        <h2 className="font-bold">設定コマンド</h2>
                        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
                            <code>{tokenCommand}</code>
                        </pre>
                        <p className="text-sm text-muted-foreground">
                            コマンドにはトークンが平文で表示されます。安全な端末で実行し、シェル履歴の取り扱いに注意してください。
                        </p>
                    </div>
                </div>
            </section>

            <section aria-labelledby="access-title">
                <div className="mb-5 flex items-center gap-3">
                    <h2 className="font-bold" id="access-title">
                        Cloudflare Access で守る場合
                    </h2>
                </div>
                <div className="flex flex-col gap-6">
                    <p className="text-sm text-muted-foreground">
                        /api を Cloudflare Access
                        で保護している間は、サービス認証の資格情報でも接続できます。
                    </p>
                    <FieldGroup>
                        <Field data-invalid={!clientIdResult.success}>
                            <FieldLabel htmlFor="cloudflare-access-client-id">
                                Cloudflare Access Client ID
                            </FieldLabel>
                            <Input
                                aria-invalid={!clientIdResult.success}
                                autoComplete="off"
                                id="cloudflare-access-client-id"
                                onChange={(event) =>
                                    setClientId(event.target.value)
                                }
                                placeholder="Client ID"
                                spellCheck={false}
                                value={clientId}
                            />
                            <FieldError
                                errors={
                                    clientIdResult.success
                                        ? undefined
                                        : clientIdResult.error.issues
                                }
                            />
                        </Field>

                        <Field data-invalid={!clientSecretResult.success}>
                            <FieldLabel htmlFor="cloudflare-access-client-secret">
                                Cloudflare Access Client Secret
                            </FieldLabel>
                            <Input
                                aria-invalid={!clientSecretResult.success}
                                autoComplete="off"
                                id="cloudflare-access-client-secret"
                                onChange={(event) =>
                                    setClientSecret(event.target.value)
                                }
                                placeholder="Client Secret"
                                spellCheck={false}
                                type="password"
                                value={clientSecret}
                            />
                            <FieldDescription>
                                入力値はこの画面内でコマンド生成にのみ使用されます。
                            </FieldDescription>
                            <FieldError
                                errors={
                                    clientSecretResult.success
                                        ? undefined
                                        : clientSecretResult.error.issues
                                }
                            />
                        </Field>
                    </FieldGroup>

                    <div className="flex flex-col gap-2">
                        <h2 className="font-bold">設定コマンド</h2>
                        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
                            <code>{accessCommand}</code>
                        </pre>
                        <p className="text-sm text-muted-foreground">
                            コマンドにはシークレットが平文で表示されます。安全な端末で実行し、シェル履歴の取り扱いに注意してください。
                        </p>
                    </div>
                </div>
            </section>
        </main>
    );
}

function createHermesTokenCommand(token: string) {
    return [
        `hermes config set mcp_servers.inventia.url ${quoteShellValue(mcpEndpointUrl)}`,
        `hermes config set mcp_servers.inventia.headers.Authorization ${quoteShellValue(`Bearer ${token}`)}`,
        "hermes mcp test inventia",
    ].join("\n");
}

function createHermesAccessCommand({
    clientId,
    clientSecret,
}: {
    clientId: string;
    clientSecret: string;
}) {
    return [
        `hermes config set mcp_servers.inventia.url ${quoteShellValue(mcpEndpointUrl)}`,
        `hermes config set mcp_servers.inventia.headers.CF-Access-Client-Id ${quoteShellValue(clientId)}`,
        `hermes config set mcp_servers.inventia.headers.CF-Access-Client-Secret ${quoteShellValue(clientSecret)}`,
        "hermes mcp test inventia",
    ].join("\n");
}

function quoteShellValue(value: string) {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}
