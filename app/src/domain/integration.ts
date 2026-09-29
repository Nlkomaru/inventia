import { z } from "zod";
import { receiptParsePromptSchema } from "./receipt";

export const openRouterProvider = "openrouter" as const;
// Perplexity が OpenRouter 上で公開する埋め込みモデル ID。MRL 対応のため
// 出力 1536 次元へ切り詰めて使い、D1 ではなく Vectorize 側の次元と合わせること。
export const openRouterEmbeddingModel = "perplexity/pplx-embed-v1-4b" as const;
export const openRouterEmbeddingDimensions = 1536 as const;

// レシート読み取り等に使うマルチモーダル LLM の既定値。
// GET https://openrouter.ai/api/v1/models で実在と画像入力対応を確認した ID のみを既定にできる。
export const openRouterDefaultChatModel = "google/gemini-3.7-flash" as const;

export const openRouterApiKeySchema = z
    .string()
    .min(1, "API key を入力してください。")
    .max(4096, "API key は 4096 文字以内で入力してください。")
    .regex(/^[^\r\n]+$/, "API key に改行は入力できません。");

export const openRouterChatModelSchema = z
    .string()
    .trim()
    .min(1, "LLM モデルを選択してください。")
    .max(200, "モデル ID は 200 文字以内で入力してください。")
    .regex(
        /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9._:-]+$/,
        "モデル ID は provider/model の形式で入力してください。",
    );

// レシート解析の指示は未指定なら既定を使う。null は「既定へ戻す」を表し、
// undefined は「今回は変更しない」を表すため、両者を区別できる形にする
export const openRouterIntegrationUpdateSchema = z
    .object({
        // 埋め込み用。画像読み取りへ流用しない
        embeddingApiKey: openRouterApiKeySchema.optional(),
        // レシート画像読み取り用。埋め込みへ流用しない
        visionApiKey: openRouterApiKeySchema.optional(),
        // 旧来の単一キー入力。両方のキーとして同時に保存する互換手段で、
        // 片方だけ変えたい場合は使わず embeddingApiKey / visionApiKey を使う
        apiKey: openRouterApiKeySchema.optional(),
        chatModel: openRouterChatModelSchema.optional(),
        receiptPrompt: receiptParsePromptSchema.nullable().optional(),
    })
    .strict()
    .refine(
        (value) =>
            value.embeddingApiKey !== undefined ||
            value.visionApiKey !== undefined ||
            value.apiKey !== undefined ||
            value.chatModel !== undefined ||
            value.receiptPrompt !== undefined,
        {
            message:
                "embeddingApiKey、visionApiKey、apiKey、chatModel、receiptPrompt のいずれかを指定してください。API key を入力しなくても他の設定だけ保存できます。",
        },
    );

export const openRouterIntegrationStatusSchema = z
    .object({
        provider: z.literal(openRouterProvider),
        // 埋め込み key の保存状態。ベクトル検索の可否だけを表す
        embeddingConfigured: z.boolean(),
        // 画像読み取り key の保存状態。レシート解析の可否だけを表す
        visionConfigured: z.boolean(),
        model: z.literal(openRouterEmbeddingModel),
        dimensions: z.literal(openRouterEmbeddingDimensions),
        chatModel: z.string(),
        chatModelConfigured: z.boolean(),
        // 解析へ実際に渡る指示。未設定なら既定の内容がそのまま入る
        receiptPrompt: z.string().min(1),
        receiptPromptConfigured: z.boolean(),
        // 埋め込み key の最終更新。未設定なら null
        embeddingUpdatedAt: z.string().datetime().nullable(),
        // 画像読み取り key の最終更新。未設定なら null
        visionUpdatedAt: z.string().datetime().nullable(),
    })
    .strict();

// 選択肢の出力 DTO。JSON Schema へ変換するため transform を持たせない。
export const openRouterChatModelOptionSchema = z
    .object({
        id: z.string(),
        name: z.string(),
    })
    .strict();

export const openRouterChatModelListSchema = z
    .object({
        models: z.array(openRouterChatModelOptionSchema),
    })
    .strict();
export const openRouterUsageByModelSchema = z
    .object({
        model: z.string().min(1),
        providerName: z.string().min(1),
        requestCount: z.int().nonnegative(),
        promptTokens: z.int().nonnegative(),
        completionTokens: z.int().nonnegative(),
        reasoningTokens: z.int().nonnegative(),
        // reasoning token は completion token に含まれるため二重計上しない
        totalTokens: z.int().nonnegative(),
        cost: z.number().nonnegative(),
    })
    .strict();

export const openRouterUsageSummarySchema = z
    .object({
        // OpenRouter Activity API が返す直近の完了済み UTC 日数
        periodDays: z.literal(30),
        requestCount: z.int().nonnegative(),
        promptTokens: z.int().nonnegative(),
        completionTokens: z.int().nonnegative(),
        reasoningTokens: z.int().nonnegative(),
        totalTokens: z.int().nonnegative(),
        cost: z.number().nonnegative(),
        models: z.array(openRouterUsageByModelSchema),
    })
    .strict();

export type OpenRouterIntegrationUpdate = z.infer<
    typeof openRouterIntegrationUpdateSchema
>;
export type OpenRouterIntegrationStatus = z.infer<
    typeof openRouterIntegrationStatusSchema
>;
export type OpenRouterChatModelOption = z.infer<
    typeof openRouterChatModelOptionSchema
>;
export type OpenRouterChatModelList = z.infer<
    typeof openRouterChatModelListSchema
>;
export type OpenRouterUsageByModel = z.infer<
    typeof openRouterUsageByModelSchema
>;
export type OpenRouterUsageSummary = z.infer<
    typeof openRouterUsageSummarySchema
>;
