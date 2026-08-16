import { z } from "zod";

export const openRouterProvider = "openrouter" as const;
export const openRouterEmbeddingModel =
    "openai/text-embedding-3-small" as const;
export const openRouterEmbeddingDimensions = 1536 as const;

export const openRouterApiKeySchema = z
    .string()
    .min(1, "API key を入力してください。")
    .max(4096, "API key は 4096 文字以内で入力してください。")
    .regex(/^[^\r\n]+$/, "API key に改行は入力できません。");

export const openRouterIntegrationUpdateSchema = z
    .object({
        apiKey: openRouterApiKeySchema,
    })
    .strict();

export const openRouterIntegrationStatusSchema = z
    .object({
        provider: z.literal(openRouterProvider),
        configured: z.boolean(),
        model: z.literal(openRouterEmbeddingModel),
        dimensions: z.literal(openRouterEmbeddingDimensions),
        updatedAt: z.string().datetime().nullable(),
    })
    .strict();

export type OpenRouterIntegrationUpdate = z.infer<
    typeof openRouterIntegrationUpdateSchema
>;
export type OpenRouterIntegrationStatus = z.infer<
    typeof openRouterIntegrationStatusSchema
>;
