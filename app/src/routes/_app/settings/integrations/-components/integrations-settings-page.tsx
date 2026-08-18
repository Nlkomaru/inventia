"use client";

import {
    useMutation,
    useQuery,
    useQueryClient,
    useSuspenseQuery,
} from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
    type OpenRouterIntegrationUpdate,
    openRouterApiKeySchema,
    openRouterChatModelSchema,
    openRouterEmbeddingDimensions,
    openRouterEmbeddingModel,
} from "@/domain/integration";
import {
    receiptParseDefaultInstructions,
    receiptParsePromptSchema,
} from "@/domain/receipt";
import { updateOpenRouterIntegration } from "../-api/integration-api";
import {
    integrationKeys,
    openRouterModelsQueryOptions,
    openRouterStatusQueryOptions,
} from "../-api/integration-queries";

// SSR と クライアントで同じ文字列になるよう時間帯を固定する。既定のままだと
// サーバー (UTC) と閲覧者の時間帯がずれ、hydration が一致しない。
const updatedAtFormat: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Tokyo",
};

export function IntegrationsSettingsPage() {
    const queryClient = useQueryClient();
    const { data: status } = useSuspenseQuery(openRouterStatusQueryOptions());
    // モデル一覧は上流 (OpenRouter) の失敗があり得るため、Suspense へ渡さず
    // この画面内のエラー表示だけに留める。
    const modelsQuery = useQuery(openRouterModelsQueryOptions());
    const models = modelsQuery.data?.models ?? [];
    const modelsError = modelsQuery.error;

    const [apiKey, setApiKey] = useState("");
    // 保存前の編集値だけをローカルに持ち、確定値は status クエリを唯一の情報源にする。
    const [chatModelDraft, setChatModelDraft] = useState<string | null>(null);
    const chatModel = chatModelDraft ?? status.chatModel;
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // 解析設定も同じく編集値だけを持ち、確定値は status を情報源にする。
    const [receiptPromptDraft, setReceiptPromptDraft] = useState<string | null>(
        null,
    );
    const receiptPrompt = receiptPromptDraft ?? status.receiptPrompt;
    const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
    const [receiptError, setReceiptError] = useState<string | null>(null);
    // 空欄は「既定へ戻す」を表すため、長さの検証だけを事前に行う。
    const receiptPromptTrimmed = receiptPrompt.trim();
    const receiptPromptValidation =
        receiptPromptTrimmed.length === 0
            ? null
            : receiptParsePromptSchema.safeParse(receiptPromptTrimmed);
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

    const saveMutation = useMutation({
        mutationFn: (input: OpenRouterIntegrationUpdate) =>
            updateOpenRouterIntegration(input),
        // 保存で変わるのは連携状態だけ。モデル一覧は上流の公開エンドポイント由来で
        // 保存の影響を受けないため無効化しない。
        onSuccess: () =>
            queryClient.invalidateQueries({
                queryKey: integrationKeys.openRouterStatus(),
            }),
    });
    const saving = saveMutation.isPending;

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
        try {
            // onSuccess の invalidate を待つため mutateAsync を使い、
            // 編集値を捨てた時点で再取得済みの状態が表示されるようにする。
            await saveMutation.mutateAsync(payload);
            setChatModelDraft(null);
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
        }
    };

    const handleReceiptSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setReceiptMessage(null);
        setReceiptError(null);
        if (receiptPromptValidation && !receiptPromptValidation.success) {
            setReceiptError(
                receiptPromptValidation.error.issues[0]?.message ??
                    "指示を確認してください。",
            );
            return;
        }
        try {
            const result = await saveMutation.mutateAsync({
                // 空欄と既定と同じ内容はどちらも「既定を使う」として保存される。
                receiptPrompt: receiptPromptValidation
                    ? receiptPromptValidation.data
                    : null,
            });
            setReceiptPromptDraft(null);
            setReceiptMessage(
                result.receiptPromptConfigured
                    ? "レシート読み取りの指示を保存しました。"
                    : "既定の指示に戻しました。",
            );
        } catch (saveError) {
            setReceiptError(
                saveError instanceof Error
                    ? saveError.message
                    : "レシート読み取りの設定を保存できませんでした。",
            );
        }
    };

    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <header>
                <h1 className="mt-1 text-2xl font-bold">AI・ベクトル検索</h1>
            </header>

            <form onSubmit={handleSubmit}>
                <section aria-labelledby="openrouter-title">
                    <div className="mb-5 flex items-center gap-3">
                        <h2 id="openrouter-title" className="font-bold">
                            OpenRouter
                        </h2>
                    </div>
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
                                    status.configured
                                        ? "新しい key で置き換える"
                                        : "OpenRouter API key"
                                }
                                spellCheck={false}
                                type="password"
                                value={apiKey}
                            />
                            <FieldDescription>
                                API key
                                はサーバー側で暗号化して保存され、保存後に画面や
                                API へ再表示されません。
                            </FieldDescription>
                            <FieldDescription>
                                {status.configured
                                    ? `設定済み（最終更新: ${new Date(
                                          status.updatedAt ?? "",
                                      ).toLocaleString(
                                          "ja-JP",
                                          updatedAtFormat,
                                      )}）`
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
                            data-invalid={chatModelValidation.success === false}
                        >
                            <FieldLabel htmlFor="openrouter-chat-model">
                                利用する LLM モデル
                            </FieldLabel>
                            <Select
                                items={modelItems}
                                value={chatModel}
                                onValueChange={(value) => {
                                    if (value !== null) {
                                        setChatModelDraft(value);
                                    }
                                }}
                            >
                                <SelectTrigger
                                    aria-invalid={
                                        chatModelValidation.success === false
                                    }
                                    className="w-full"
                                    disabled={modelsQuery.isPending}
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
                                {modelsQuery.isPending
                                    ? "モデル一覧を取得しています。"
                                    : `選択中: ${chatModel}`}
                                {status.chatModelConfigured
                                    ? null
                                    : "（既定値。まだ保存されていません）"}
                            </FieldDescription>
                            <div aria-live="polite">
                                {modelsError ? (
                                    <FieldError>
                                        {`${
                                            modelsError instanceof Error
                                                ? modelsError.message
                                                : "モデル一覧を取得できませんでした。"
                                        }現在のモデルはそのまま保存できます。`}
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
                                ベクトル化モデル（
                                {openRouterEmbeddingDimensions} 次元）
                            </FieldLabel>
                            <Input
                                disabled
                                id="vectorization-model"
                                value={openRouterEmbeddingModel}
                            />
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
                    <div className="flex justify-end">
                        <Button
                            disabled={
                                saving || chatModelValidation.success === false
                            }
                            type="submit"
                        >
                            {saving ? "保存中…" : "保存"}
                        </Button>
                    </div>
                </section>
            </form>

            <form onSubmit={handleReceiptSubmit}>
                <section aria-labelledby="receipt-parse-title">
                    <div className="mb-5 flex items-center gap-3">
                        <h2 id="receipt-parse-title" className="font-bold">
                            レシート読み取り
                        </h2>
                    </div>
                    <FieldGroup>
                        <Field
                            data-invalid={
                                receiptPromptValidation?.success === false
                            }
                        >
                            <FieldLabel htmlFor="receipt-parse-prompt">
                                解析の指示
                            </FieldLabel>
                            <Textarea
                                aria-invalid={
                                    receiptPromptValidation?.success === false
                                }
                                className="min-h-64 font-mono text-xs"
                                id="receipt-parse-prompt"
                                onChange={(event) =>
                                    setReceiptPromptDraft(event.target.value)
                                }
                                spellCheck={false}
                                value={receiptPrompt}
                            />
                            <FieldDescription>
                                {status.receiptPromptConfigured
                                    ? "既定から変更されています。空欄で保存すると既定へ戻ります。"
                                    : "既定の指示を使用中です。"}
                                画像に写った文章を指示として扱わせない行は、レシート写真を使った指示の混入を防ぐためのものです。書き換える場合も残すことを勧めます。
                            </FieldDescription>
                            <FieldError
                                errors={
                                    receiptPromptValidation?.success === false
                                        ? receiptPromptValidation.error.issues
                                        : undefined
                                }
                            />
                        </Field>
                    </FieldGroup>
                    <div aria-live="polite" className="mt-5">
                        {receiptMessage ? (
                            <p className="text-sm text-muted-foreground">
                                {receiptMessage}
                            </p>
                        ) : null}
                        {receiptError ? (
                            <FieldError>{receiptError}</FieldError>
                        ) : null}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            disabled={
                                saving ||
                                receiptPrompt ===
                                    receiptParseDefaultInstructions
                            }
                            onClick={() =>
                                setReceiptPromptDraft(
                                    receiptParseDefaultInstructions,
                                )
                            }
                            type="button"
                            variant="outline"
                        >
                            既定に戻す
                        </Button>
                        <Button
                            disabled={
                                saving ||
                                receiptPromptValidation?.success === false
                            }
                            type="submit"
                        >
                            {saving ? "保存中…" : "保存"}
                        </Button>
                    </div>
                </section>
            </form>
        </main>
    );
}
