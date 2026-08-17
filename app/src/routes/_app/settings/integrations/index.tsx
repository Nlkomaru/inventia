"use client";

import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useMemo, useState } from "react";
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
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    type OpenRouterChatModelOption,
    type OpenRouterIntegrationStatus,
    openRouterApiKeySchema,
    openRouterChatModelListSchema,
    openRouterChatModelSchema,
    openRouterDefaultChatModel,
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
    const [chatModel, setChatModel] = useState<string>(
        openRouterDefaultChatModel,
    );
    const [status, setStatus] = useState<OpenRouterIntegrationStatus | null>(
        null,
    );
    const [models, setModels] = useState<OpenRouterChatModelOption[]>([]);
    const [modelsLoading, setModelsLoading] = useState(true);
    const [modelsError, setModelsError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const validation = apiKey ? openRouterApiKeySchema.safeParse(apiKey) : null;
    const chatModelValidation = openRouterChatModelSchema.safeParse(chatModel);

    // 保存済みモデルが一覧に無い場合（提供終了・取得失敗）も現在値を選択肢として残す。
    const modelItems = useMemo(() => {
        const options = models.some((model) => model.id === chatModel)
            ? models
            : [{ id: chatModel, name: chatModel }, ...models];
        return options.map((model) => ({
            label: model.name,
            value: model.id,
        }));
    }, [chatModel, models]);

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
                setChatModel(parsed.data.chatModel);
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

    useEffect(() => {
        const controller = new AbortController();
        const load = async () => {
            try {
                const response = await fetch(
                    "/api/settings/integrations/openrouter/models",
                    { signal: controller.signal },
                );
                if (!response.ok) {
                    throw new Error(await readApiError(response));
                }
                const parsed = openRouterChatModelListSchema.safeParse(
                    await response.json(),
                );
                if (!parsed.success) {
                    throw new Error("モデル一覧の応答を確認できませんでした。");
                }
                setModels(parsed.data.models);
            } catch (loadError) {
                if (!controller.signal.aborted) {
                    setModelsError(
                        loadError instanceof Error
                            ? loadError.message
                            : "モデル一覧を取得できませんでした。",
                    );
                }
            } finally {
                if (!controller.signal.aborted) {
                    setModelsLoading(false);
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
        const parsedApiKey = apiKey
            ? openRouterApiKeySchema.safeParse(apiKey)
            : null;
        if (parsedApiKey && !parsedApiKey.success) {
            setError(
                parsedApiKey.error.issues[0]?.message ??
                    "API key を確認してください。",
            );
            return;
        }
        if (!chatModelValidation.success) {
            setError(
                chatModelValidation.error.issues[0]?.message ??
                    "LLM モデルを確認してください。",
            );
            return;
        }
        // API key を入力していなくてもモデルだけ保存できる。
        const payload = {
            ...(parsedApiKey ? { apiKey: parsedApiKey.data } : {}),
            chatModel: chatModelValidation.data,
        };
        setSaving(true);
        try {
            const response = await fetch(
                "/api/settings/integrations/openrouter",
                {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(payload),
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
            setChatModel(updated.data.chatModel);
            setApiKey("");
            setMessage(
                parsedApiKey
                    ? "OpenRouter API key と LLM モデルを保存しました。"
                    : "LLM モデルを保存しました。",
            );
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
                    OpenRouter の認証情報と、利用するモデルを設定します。
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

                            <Field
                                data-invalid={
                                    chatModelValidation.success === false
                                }
                            >
                                <FieldLabel htmlFor="openrouter-chat-model">
                                    利用する LLM モデル
                                </FieldLabel>
                                <Select
                                    items={modelItems}
                                    value={chatModel}
                                    onValueChange={(value) => {
                                        if (value !== null) {
                                            setChatModel(value);
                                        }
                                    }}
                                >
                                    <SelectTrigger
                                        aria-invalid={
                                            chatModelValidation.success ===
                                            false
                                        }
                                        className="w-full"
                                        disabled={loading || modelsLoading}
                                        id="openrouter-chat-model"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {modelItems.map((model) => (
                                                <SelectItem
                                                    key={model.value}
                                                    value={model.value}
                                                >
                                                    {model.label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                <FieldDescription>
                                    レシート読み取りなど画像を読む処理に使う、画像入力対応モデルです。
                                    {modelsLoading
                                        ? "モデル一覧を取得しています。"
                                        : `選択中: ${chatModel}`}
                                    {status && !status.chatModelConfigured
                                        ? "（既定値。まだ保存されていません）"
                                        : null}
                                </FieldDescription>
                                <div aria-live="polite">
                                    {modelsError ? (
                                        <FieldError>
                                            {`${modelsError}現在のモデルはそのまま保存できます。`}
                                        </FieldError>
                                    ) : null}
                                </div>
                                <FieldError
                                    errors={
                                        chatModelValidation.success === false
                                            ? chatModelValidation.error.issues
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
                                    次元の embedding
                                    を生成します。このモデルは変更できません。
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
                            disabled={
                                saving ||
                                loading ||
                                chatModelValidation.success === false
                            }
                            type="submit"
                        >
                            {saving ? "保存中…" : "保存"}
                        </Button>
                    </CardFooter>
                </Card>
            </form>
        </main>
    );
}
