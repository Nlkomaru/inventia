"use client";

import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
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
import {
    type OpenRouterIntegrationStatus,
    openRouterApiKeySchema,
    openRouterEmbeddingDimensions,
    openRouterEmbeddingModel,
    openRouterIntegrationStatusSchema,
} from "@/domain/integration";

export const Route = createFileRoute("/_app/settings/integrations/")({
    staticData: {
        breadcrumbs: [
            { label: "Inventia", to: "/inventory" },
            { label: "設定" },
            { label: "AI・ベクトル検索" },
        ],
    },
    component: IntegrationsSettingsPage,
});

const apiErrorSchema = z.object({
    error: z.object({ message: z.string() }),
});

const readApiError = async (response: Response): Promise<string> => {
    const body: unknown = await response.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
        return parsed.data.error.message;
    }
    return "連携設定を保存できませんでした。";
};

function IntegrationsSettingsPage() {
    const [apiKey, setApiKey] = useState("");
    const [status, setStatus] = useState<OpenRouterIntegrationStatus | null>(
        null,
    );
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const validation = apiKey ? openRouterApiKeySchema.safeParse(apiKey) : null;

    useEffect(() => {
        const controller = new AbortController();
        const load = async () => {
            try {
                const response = await fetch(
                    "/api/settings/integrations/openrouter",
                    { signal: controller.signal },
                );
                if (!response.ok) {
                    throw new Error(await readApiError(response));
                }
                const parsed = openRouterIntegrationStatusSchema.safeParse(
                    await response.json(),
                );
                if (!parsed.success) {
                    throw new Error("連携設定の応答を確認できませんでした。");
                }
                setStatus(parsed.data);
            } catch (loadError) {
                if (!controller.signal.aborted) {
                    setError(
                        loadError instanceof Error
                            ? loadError.message
                            : "連携設定を取得できませんでした。",
                    );
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        };
        void load();
        return () => controller.abort();
    }, []);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setMessage(null);
        setError(null);
        const parsed = openRouterApiKeySchema.safeParse(apiKey);
        if (!parsed.success) {
            setError(
                parsed.error.issues[0]?.message ??
                    "API key を確認してください。",
            );
            return;
        }
        setSaving(true);
        try {
            const response = await fetch(
                "/api/settings/integrations/openrouter",
                {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ apiKey: parsed.data }),
                },
            );
            if (!response.ok) {
                throw new Error(await readApiError(response));
            }
            const updated = openRouterIntegrationStatusSchema.safeParse(
                await response.json(),
            );
            if (!updated.success) {
                throw new Error("連携設定の応答を確認できませんでした。");
            }
            setStatus(updated.data);
            setApiKey("");
            setMessage("OpenRouter API key を保存しました。");
        } catch (saveError) {
            setError(
                saveError instanceof Error
                    ? saveError.message
                    : "連携設定を保存できませんでした。",
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold">AI・ベクトル検索</h1>
                <p className="text-muted-foreground">
                    OpenRouter の認証情報とベクトル化モデルを設定します。
                </p>
            </div>

            <form onSubmit={handleSubmit}>
                <Card>
                    <CardHeader>
                        <CardTitle>OpenRouter</CardTitle>
                        <CardDescription>
                            API key
                            はサーバー側で暗号化して保存され、保存後に画面や API
                            へ再表示されません。
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <FieldGroup>
                            <Field data-invalid={validation?.success === false}>
                                <FieldLabel htmlFor="openrouter-api-key">
                                    API key
                                </FieldLabel>
                                <Input
                                    aria-invalid={validation?.success === false}
                                    autoComplete="new-password"
                                    id="openrouter-api-key"
                                    onChange={(event) =>
                                        setApiKey(event.target.value)
                                    }
                                    placeholder={
                                        status?.configured
                                            ? "新しい key で置き換える"
                                            : "OpenRouter API key"
                                    }
                                    spellCheck={false}
                                    type="password"
                                    value={apiKey}
                                />
                                <FieldDescription>
                                    {loading
                                        ? "設定状態を確認しています。"
                                        : status?.configured
                                          ? `設定済み（最終更新: ${new Date(status.updatedAt ?? "").toLocaleString("ja-JP")}）`
                                          : "未設定です。"}
                                </FieldDescription>
                                <FieldError
                                    errors={
                                        validation?.success === false
                                            ? validation.error.issues
                                            : undefined
                                    }
                                />
                            </Field>

                            <Field data-disabled>
                                <FieldLabel htmlFor="vectorization-model">
                                    ベクトル化モデル
                                </FieldLabel>
                                <Input
                                    disabled
                                    id="vectorization-model"
                                    value={openRouterEmbeddingModel}
                                />
                                <FieldDescription>
                                    OpenRouter 経由で{" "}
                                    {openRouterEmbeddingDimensions}
                                    次元の embedding を生成します。
                                </FieldDescription>
                            </Field>
                        </FieldGroup>
                        <div aria-live="polite" className="mt-5">
                            {message ? (
                                <p className="text-sm text-muted-foreground">
                                    {message}
                                </p>
                            ) : null}
                            {error ? <FieldError>{error}</FieldError> : null}
                        </div>
                    </CardContent>
                    <CardFooter className="justify-end">
                        <Button
                            disabled={saving || loading || !apiKey}
                            type="submit"
                        >
                            {saving ? "保存中…" : "API key を保存"}
                        </Button>
                    </CardFooter>
                </Card>
            </form>
        </main>
    );
}
