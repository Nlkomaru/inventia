"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/settings/mcp/")({
    staticData: {
        breadcrumbs: [
            { label: "Inventia", to: "/inventory" },
            { label: "設定" },
            { label: "MCP エンドポイント" },
        ],
    },
    component: McpSettingsPage,
});

const mcpEndpointUrl = "https://inventia.nikomaru.dev/api/mcp";
const credentialSchema = z
    .string()
    .max(4096, "4096 文字以内で入力してください。")
    .regex(/^[^\r\n]*$/, "改行は入力できません。");

function McpSettingsPage() {
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");
    const clientIdResult = credentialSchema.safeParse(clientId);
    const clientSecretResult = credentialSchema.safeParse(clientSecret);
    const hermesCommand = createHermesCommand({
        clientId: clientIdResult.success && clientId ? clientId : "<CLIENT_ID>",
        clientSecret:
            clientSecretResult.success && clientSecret
                ? clientSecret
                : "<CLIENT_SECRET>",
    });

    return (
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold">MCP 設定</h1>
                <p className="text-muted-foreground">
                    Hermes Agent へ Inventia の MCP サーバーを登録します。
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Hermes Agent</CardTitle>
                    <CardDescription>
                        Cloudflare Access のサービス トークンを入力すると、
                        Hermes 用の設定コマンドへ自動的に反映されます。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-6">
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
                        <h2 className="font-medium">設定コマンド</h2>
                        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
                            <code>{hermesCommand}</code>
                        </pre>
                        <p className="text-sm text-muted-foreground">
                            コマンドにはシークレットが平文で表示されます。安全な端末で実行し、シェル履歴の取り扱いに注意してください。
                        </p>
                    </div>
                </CardContent>
            </Card>
        </main>
    );
}

function createHermesCommand({
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
