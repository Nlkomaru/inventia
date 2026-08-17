import { z } from "zod";
import {
    type OpenRouterChatModelList,
    type OpenRouterChatModelOption,
    type OpenRouterIntegrationStatus,
    openRouterApiKeySchema,
    openRouterChatModelSchema,
    openRouterDefaultChatModel,
    openRouterEmbeddingDimensions,
    openRouterEmbeddingModel,
    openRouterIntegrationUpdateSchema,
    openRouterProvider,
} from "../domain/integration";
import {
    getOpenRouterCredential,
    getOpenRouterSettings,
    upsertOpenRouterCredential,
    upsertOpenRouterSettings,
} from "../repositories/integrationRepository";

export type IntegrationServiceErrorCode =
    | "INTEGRATION_INVALID_INPUT"
    | "INTEGRATION_PROVIDER_ERROR"
    | "INTEGRATION_ENCRYPTION_UNAVAILABLE";

const statusByCode: Record<IntegrationServiceErrorCode, 400 | 502 | 503> = {
    INTEGRATION_INVALID_INPUT: 400,
    INTEGRATION_PROVIDER_ERROR: 502,
    INTEGRATION_ENCRYPTION_UNAVAILABLE: 503,
};

export class IntegrationServiceError extends Error {
    readonly status: 400 | 502 | 503;

    constructor(
        readonly code: IntegrationServiceErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "IntegrationServiceError";
        this.status = statusByCode[code];
    }
}

const textEncoder = new TextEncoder();

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array | null => {
    try {
        const binary = atob(value);
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
        return null;
    }
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
};

const importEncryptionKey = async (secret: string | undefined) => {
    const keyBytes = secret ? base64ToBytes(secret) : null;
    if (!keyBytes || keyBytes.byteLength !== 32) {
        throw new IntegrationServiceError(
            "INTEGRATION_ENCRYPTION_UNAVAILABLE",
            "連携設定を保存できません。管理者が SETTINGS_ENCRYPTION_KEY を設定してください。",
        );
    }
    return crypto.subtle.importKey(
        "raw",
        toArrayBuffer(keyBytes),
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
    );
};

const encryptApiKey = async (
    apiKey: string,
    encryptionSecret: string,
): Promise<{ ciphertext: string; initializationVector: string }> => {
    const key = await importEncryptionKey(encryptionSecret);
    const initializationVector = crypto.getRandomValues(
        new Uint8Array(new ArrayBuffer(12)),
    );
    const ciphertext = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: toArrayBuffer(initializationVector),
            additionalData: toArrayBuffer(
                textEncoder.encode(openRouterProvider),
            ),
        },
        key,
        toArrayBuffer(textEncoder.encode(apiKey)),
    );
    return {
        ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
        initializationVector: bytesToBase64(initializationVector),
    };
};

const decryptApiKey = async (
    ciphertext: string,
    initializationVector: string,
    encryptionSecret: string,
): Promise<string> => {
    const encryptedBytes = base64ToBytes(ciphertext);
    const initializationVectorBytes = base64ToBytes(initializationVector);
    if (!encryptedBytes || initializationVectorBytes?.byteLength !== 12) {
        throw new Error("Stored OpenRouter credential is malformed");
    }
    try {
        const key = await importEncryptionKey(encryptionSecret);
        const plaintext = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: toArrayBuffer(initializationVectorBytes),
                additionalData: toArrayBuffer(
                    textEncoder.encode(openRouterProvider),
                ),
            },
            key,
            toArrayBuffer(encryptedBytes),
        );
        return new TextDecoder().decode(plaintext);
    } catch {
        throw new Error("Stored OpenRouter credential could not be decrypted");
    }
};

const toStatus = (
    credentialUpdatedAt: string | null,
    chatModel: string | null,
): OpenRouterIntegrationStatus => ({
    provider: openRouterProvider,
    configured: credentialUpdatedAt !== null,
    model: openRouterEmbeddingModel,
    dimensions: openRouterEmbeddingDimensions,
    chatModel: chatModel ?? openRouterDefaultChatModel,
    chatModelConfigured: chatModel !== null,
    updatedAt: credentialUpdatedAt,
});

export const getOpenRouterIntegrationStatus = async (
    db: D1Database,
): Promise<OpenRouterIntegrationStatus> => {
    const [credential, settings] = await Promise.all([
        getOpenRouterCredential(db),
        getOpenRouterSettings(db),
    ]);
    return toStatus(credential?.updatedAt ?? null, settings?.chatModel ?? null);
};

export const updateOpenRouterIntegration = async (
    db: D1Database,
    encryptionSecret: string,
    input: unknown,
): Promise<OpenRouterIntegrationStatus> => {
    const parsed = openRouterIntegrationUpdateSchema.safeParse(input);
    if (!parsed.success) {
        throw new IntegrationServiceError(
            "INTEGRATION_INVALID_INPUT",
            parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
        );
    }
    const { apiKey, chatModel } = parsed.data;
    // 暗号化を先に行い、鍵が無いときにモデルだけ保存された状態を作らない。
    const encrypted =
        apiKey === undefined
            ? null
            : await encryptApiKey(apiKey, encryptionSecret);
    const now = new Date().toISOString();
    if (encrypted) {
        await upsertOpenRouterCredential(db, {
            ...encrypted,
            createdAt: now,
            updatedAt: now,
        });
    }
    if (chatModel !== undefined) {
        await upsertOpenRouterSettings(db, {
            chatModel,
            createdAt: now,
            updatedAt: now,
        });
    }
    return getOpenRouterIntegrationStatus(db);
};

// OpenRouter の公開エンドポイントの応答。必要な項目だけを緩く検証し、
// 想定外の項目を持つモデルが 1 件あっても一覧全体を失敗させない。
const openRouterModelsEnvelopeSchema = z.object({
    data: z.array(z.unknown()),
});

const openRouterModelEntrySchema = z.object({
    id: z.string(),
    name: z.string(),
    architecture: z.object({
        input_modalities: z.array(z.string()),
    }),
});

const providerError = () =>
    new IntegrationServiceError(
        "INTEGRATION_PROVIDER_ERROR",
        "OpenRouter からモデル一覧を取得できませんでした。時間をおいて再試行してください。",
    );

/** OpenRouter の認証情報があれば返す。取得・復号に失敗しても一覧取得は続行する。 */
const readApiKeyForModelList = async (
    db: D1Database,
    encryptionSecret: string,
): Promise<string | null> => {
    try {
        return await getOpenRouterApiKey(db, encryptionSecret);
    } catch {
        return null;
    }
};

/**
 * 画像入力に対応したモデルだけを選択肢として返す。
 * モデル一覧は API key 未設定でも取得できる公開エンドポイントで、応答に API key は含めない。
 */
export const listOpenRouterVisionModels = async (
    db: D1Database,
    encryptionSecret: string,
    fetcher: typeof fetch = fetch,
): Promise<OpenRouterChatModelList> => {
    const apiKey = await readApiKeyForModelList(db, encryptionSecret);
    let payload: unknown;
    try {
        const response = await fetcher("https://openrouter.ai/api/v1/models", {
            headers: {
                accept: "application/json",
                ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
            },
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            throw providerError();
        }
        payload = await response.json();
    } catch {
        throw providerError();
    }
    const envelope = openRouterModelsEnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
        throw providerError();
    }
    const models: OpenRouterChatModelOption[] = [];
    for (const entry of envelope.data.data) {
        const model = openRouterModelEntrySchema.safeParse(entry);
        if (!model.success) {
            continue;
        }
        if (!model.data.architecture.input_modalities.includes("image")) {
            continue;
        }
        // 保存できない ID を選択肢に出さないため、保存時と同じ検証を通す。
        const id = openRouterChatModelSchema.safeParse(model.data.id);
        if (!id.success) {
            continue;
        }
        models.push({ id: id.data, name: model.data.name });
    }
    models.sort(
        (left, right) =>
            left.name.localeCompare(right.name, "en") ||
            left.id.localeCompare(right.id, "en"),
    );
    return { models };
};

/** Returns the credential only to server-side callers that invoke OpenRouter. */
export const getOpenRouterApiKey = async (
    db: D1Database,
    encryptionSecret: string,
): Promise<string> => {
    const credential = await getOpenRouterCredential(db);
    if (!credential) {
        throw new Error("OpenRouter is not configured");
    }
    const apiKey = await decryptApiKey(
        credential.ciphertext,
        credential.initializationVector,
        encryptionSecret,
    );
    const parsed = openRouterApiKeySchema.safeParse(apiKey);
    if (!parsed.success) {
        throw new Error("Stored OpenRouter credential is invalid");
    }
    return parsed.data;
};
