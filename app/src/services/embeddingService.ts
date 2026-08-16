import { z } from "zod";
import {
    openRouterEmbeddingDimensions,
    openRouterEmbeddingModel,
} from "../domain/integration";
import { getOpenRouterApiKey } from "./integrationService";

const embeddingInputSchema = z.union([
    z.string().min(1).max(100_000),
    z.array(z.string().min(1).max(100_000)).min(1).max(100),
]);

const openRouterEmbeddingResponseSchema = z.object({
    data: z.array(
        z.object({
            embedding: z
                .array(z.number())
                .length(openRouterEmbeddingDimensions),
            index: z.number().int().nonnegative(),
        }),
    ),
});

export class EmbeddingServiceError extends Error {
    constructor(
        readonly code:
            | "EMBEDDING_INVALID_INPUT"
            | "EMBEDDING_NOT_CONFIGURED"
            | "EMBEDDING_PROVIDER_ERROR"
            | "EMBEDDING_INVALID_RESPONSE",
        message: string,
    ) {
        super(message);
        this.name = "EmbeddingServiceError";
    }
}

/** Generates Vectorize-compatible embeddings through OpenRouter. */
export const createOpenRouterEmbeddings = async (
    db: D1Database,
    encryptionSecret: string,
    input: unknown,
    fetcher: typeof fetch = fetch,
): Promise<number[][]> => {
    const parsedInput = embeddingInputSchema.safeParse(input);
    if (!parsedInput.success) {
        throw new EmbeddingServiceError(
            "EMBEDDING_INVALID_INPUT",
            "ベクトル化するテキストを確認してください。",
        );
    }

    let apiKey: string;
    try {
        apiKey = await getOpenRouterApiKey(db, encryptionSecret);
    } catch {
        throw new EmbeddingServiceError(
            "EMBEDDING_NOT_CONFIGURED",
            "OpenRouter API key を連携設定から保存してください。",
        );
    }

    let response: Response;
    try {
        response = await fetcher("https://openrouter.ai/api/v1/embeddings", {
            method: "POST",
            headers: {
                authorization: `Bearer ${apiKey}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: openRouterEmbeddingModel,
                input: parsedInput.data,
                dimensions: openRouterEmbeddingDimensions,
                encoding_format: "float",
            }),
        });
    } catch {
        throw new EmbeddingServiceError(
            "EMBEDDING_PROVIDER_ERROR",
            "OpenRouter へ接続できませんでした。",
        );
    }
    if (!response.ok) {
        throw new EmbeddingServiceError(
            "EMBEDDING_PROVIDER_ERROR",
            "OpenRouter で embedding を生成できませんでした。",
        );
    }

    const body: unknown = await response.json().catch(() => null);
    const parsedResponse = openRouterEmbeddingResponseSchema.safeParse(body);
    if (!parsedResponse.success) {
        throw new EmbeddingServiceError(
            "EMBEDDING_INVALID_RESPONSE",
            "OpenRouter の embedding 応答を確認できませんでした。",
        );
    }
    const expectedCount =
        typeof parsedInput.data === "string" ? 1 : parsedInput.data.length;
    if (parsedResponse.data.data.length !== expectedCount) {
        throw new EmbeddingServiceError(
            "EMBEDDING_INVALID_RESPONSE",
            "OpenRouter の embedding 件数が一致しませんでした。",
        );
    }
    const embeddings = [...parsedResponse.data.data].sort(
        (left, right) => left.index - right.index,
    );
    if (embeddings.some((item, index) => item.index !== index)) {
        throw new EmbeddingServiceError(
            "EMBEDDING_INVALID_RESPONSE",
            "OpenRouter の embedding 順序を確認できませんでした。",
        );
    }
    return embeddings.map((item) => item.embedding);
};
