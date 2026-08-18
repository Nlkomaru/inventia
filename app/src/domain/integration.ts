import { z } from "zod";
import { receiptParsePromptSchema } from "./receipt";

export const openRouterProvider = "openrouter" as const;
export const openRouterEmbeddingModel =
    "openai/text-embedding-3-small" as const;
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
        apiKey: openRouterApiKeySchema.optional(),
        chatModel: openRouterChatModelSchema.optional(),
        receiptPrompt: receiptParsePromptSchema.nullable().optional(),
        receiptToolsEnabled: z.boolean().optional(),
    })
    .strict()
    .refine(
        (value) =>
            value.apiKey !== undefined ||
            value.chatModel !== undefined ||
            value.receiptPrompt !== undefined ||
            value.receiptToolsEnabled !== undefined,
        {
            message:
                "apiKey、chatModel、receiptPrompt、receiptToolsEnabled のいずれかを指定してください。API key を入力しなくても他の設定だけ保存できます。",
        },
    );

export const openRouterIntegrationStatusSchema = z
    .object({
        provider: z.literal(openRouterProvider),
        configured: z.boolean(),
        model: z.literal(openRouterEmbeddingModel),
        dimensions: z.literal(openRouterEmbeddingDimensions),
        chatModel: z.string(),
        chatModelConfigured: z.boolean(),
        // 解析へ実際に渡る指示。未設定なら既定の内容がそのまま入る
        receiptPrompt: z.string().min(1),
        receiptPromptConfigured: z.boolean(),
        receiptToolsEnabled: z.boolean(),
        updatedAt: z.string().datetime().nullable(),
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
