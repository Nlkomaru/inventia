"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, KeyRoundIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
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
    FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiTokenCreateSchema, type IssuedApiToken } from "@/domain/apiToken";
import { formatDisplayDateTime } from "@/lib/datetime";
import { createApiToken, revokeApiToken } from "../-api/token-api";
import { apiTokenKeys, apiTokensQueryOptions } from "../-api/token-queries";

const apiBaseUrl = "https://inventia.nikomaru.dev";
const mcpEndpointUrl = `${apiBaseUrl}/api/mcp`;

const formatDateTime = (value: string): string =>
    formatDisplayDateTime(value) ?? value;

const curlExample = (token: string): string =>
    `curl -H "Authorization: Bearer ${token}" "${apiBaseUrl}/api/items?q=%E7%89%9B%E4%B9%B3"`;

const mcpExample = `{
  "mcpServers": {
    "inventia": {
      "url": "${mcpEndpointUrl}",
      "headers": { "Authorization": "Bearer <API トークン>" }
    }
  }
}`;

export function TokenSettingsPage() {
    const queryClient = useQueryClient();
    const tokensQuery = useQuery(apiTokensQueryOptions());
    const [name, setName] = useState("");
    const [issued, setIssued] = useState<IssuedApiToken | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    // トーストを持たないので、コピー結果は読み上げ専用の領域だけで伝える
    const [copyAnnouncement, setCopyAnnouncement] = useState({
        seq: 0,
        text: "",
    });

    const announceCopy = useCallback(
        (text: string) =>
            setCopyAnnouncement((current) => ({ seq: current.seq + 1, text })),
        [],
    );

    const copyText = useCallback(
        (value: string, label: string) => {
            // 安全なコンテキスト以外では navigator.clipboard 自体が存在しない
            if (!navigator.clipboard) {
                announceCopy(`${label}をコピーできませんでした`);
                return;
            }
            void navigator.clipboard
                .writeText(value)
                .then(() => announceCopy(`${label}をコピーしました`))
                .catch(() => announceCopy(`${label}をコピーできませんでした`));
        },
        [announceCopy],
    );

    const nameValidation = name.trim()
        ? apiTokenCreateSchema.safeParse({ name })
        : null;

    const createMutation = useMutation({
        mutationFn: (input: { name: string }) =>
            createApiToken({ data: input }),
        onSuccess: async (result) => {
            setIssued(result);
            setName("");
            await queryClient.invalidateQueries({
                queryKey: apiTokenKeys.list(),
            });
        },
    });

    const revokeMutation = useMutation({
        mutationFn: (id: string) => revokeApiToken({ data: { id } }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: apiTokenKeys.list(),
            });
        },
    });

    const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setFormError(null);
        const parsed = apiTokenCreateSchema.safeParse({ name });
        if (!parsed.success) {
            setFormError(
                parsed.error.issues.map((issue) => issue.message).join(" / "),
            );
            return;
        }
        try {
            await createMutation.mutateAsync(parsed.data);
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "API トークンを発行できませんでした。",
            );
        }
    };

    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <header>
                <h1 className="mt-1 text-2xl font-bold">API トークン</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    HTTP API と MCP を外部から呼ぶためのトークンです。Cloudflare
                    Access を無効にした /api でも、このトークンで認証します。
                </p>
            </header>

            <span
                aria-live="polite"
                className="sr-only"
                key={copyAnnouncement.seq}
            >
                {copyAnnouncement.text}
            </span>

            <Card>
                <CardHeader>
                    <CardTitle>トークンを発行する</CardTitle>
                    <CardDescription>
                        用途ごとに発行し、使わなくなったら失効させてください。値は発行時にしか表示できません。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <form
                        className="flex flex-col gap-4 sm:max-w-xl"
                        onSubmit={handleCreate}
                    >
                        <Field data-invalid={nameValidation?.success === false}>
                            <FieldLabel htmlFor="api-token-name">
                                名前
                            </FieldLabel>
                            <Input
                                autoComplete="off"
                                id="api-token-name"
                                maxLength={100}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                                placeholder="例: cho、ノートPC のスクリプト"
                                value={name}
                            />
                            <FieldDescription>
                                どの用途のトークンか分かる名前にします。
                            </FieldDescription>
                            <FieldError
                                errors={
                                    nameValidation?.success === false
                                        ? nameValidation.error.issues
                                        : undefined
                                }
                            />
                        </Field>
                        <div>
                            <Button
                                disabled={createMutation.isPending}
                                type="submit"
                            >
                                <KeyRoundIcon aria-hidden="true" />
                                {createMutation.isPending
                                    ? "発行しています…"
                                    : "発行する"}
                            </Button>
                        </div>
                    </form>

                    {formError ? (
                        <div
                            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                            role="alert"
                        >
                            {formError}
                        </div>
                    ) : null}

                    {issued ? (
                        <div className="flex flex-col gap-2 rounded-lg border p-3">
                            <p className="font-medium">
                                発行しました。この値は再表示できません。
                            </p>
                            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
                                <code>{issued.secret}</code>
                            </pre>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    onClick={() =>
                                        copyText(issued.secret, "API トークン")
                                    }
                                    type="button"
                                    variant="outline"
                                >
                                    <CopyIcon aria-hidden="true" />
                                    コピー
                                </Button>
                                <Button
                                    onClick={() =>
                                        copyText(
                                            curlExample(issued.secret),
                                            "curl の例",
                                        )
                                    }
                                    type="button"
                                    variant="outline"
                                >
                                    <CopyIcon aria-hidden="true" />
                                    curl の例をコピー
                                </Button>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                トークンはパスワードと同じように扱ってください。画面を離れると{" "}
                                {issued.token.name} の値は確認できなくなります。
                            </p>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>発行済みのトークン</CardTitle>
                    <CardDescription>
                        失効させたトークンは、行を残したまま使えなくなります。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                    {tokensQuery.isPending ? (
                        <p className="text-sm text-muted-foreground">
                            読み込んでいます…
                        </p>
                    ) : null}
                    {tokensQuery.isError ? (
                        <div
                            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                            role="alert"
                        >
                            {tokensQuery.error instanceof Error
                                ? tokensQuery.error.message
                                : "トークンの一覧を取得できませんでした。"}
                        </div>
                    ) : null}
                    {tokensQuery.data && tokensQuery.data.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            まだトークンがありません。
                        </p>
                    ) : null}
                    <ul className="flex flex-col gap-2">
                        {(tokensQuery.data ?? []).map((token) => (
                            <li
                                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                                key={token.id}
                            >
                                <div className="flex flex-col gap-1">
                                    <span className="font-medium">
                                        {token.name}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {token.tokenPrefix}…
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        作成 {formatDateTime(token.createdAt)}
                                        {" / "}
                                        {token.lastUsedAt
                                            ? `最終使用 ${formatDateTime(token.lastUsedAt)}`
                                            : "未使用"}
                                        {token.revokedAt
                                            ? ` / 失効 ${formatDateTime(token.revokedAt)}`
                                            : ""}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {token.revokedAt ? (
                                        <span className="text-sm text-muted-foreground">
                                            失効済み
                                        </span>
                                    ) : (
                                        <Button
                                            disabled={revokeMutation.isPending}
                                            onClick={() =>
                                                revokeMutation.mutate(token.id)
                                            }
                                            size="sm"
                                            type="button"
                                            variant="outline"
                                        >
                                            失効させる
                                        </Button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                    {revokeMutation.isError ? (
                        <div
                            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                            role="alert"
                        >
                            {revokeMutation.error instanceof Error
                                ? revokeMutation.error.message
                                : "トークンを失効できませんでした。"}
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>使い方</CardTitle>
                    <CardDescription>
                        リクエストの Authorization ヘッダーへ Bearer
                        で付けます。/api/health、/api/openapi、/api/scalar
                        はトークン無しでも取得できます。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <h2 className="font-bold">HTTP API</h2>
                        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
                            <code>{curlExample("<API トークン>")}</code>
                        </pre>
                    </div>
                    <div className="flex flex-col gap-2">
                        <h2 className="font-bold">MCP クライアント</h2>
                        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
                            <code>{mcpExample}</code>
                        </pre>
                        <p className="text-sm text-muted-foreground">
                            Cloudflare Access
                            のサービス認証を使う場合は、従来どおり 「MCP
                            エンドポイント」の設定コマンドを使ってください。
                        </p>
                    </div>
                </CardContent>
            </Card>
        </main>
    );
}
