import {
    type OpenRouterIntegrationStatus,
    openRouterEmbeddingDimensions,
    openRouterEmbeddingModel,
    openRouterIntegrationUpdateSchema,
    openRouterProvider,
} from "../domain/integration";
import {
    getOpenRouterCredential,
    upsertOpenRouterCredential,
} from "../repositories/integrationRepository";

export type IntegrationServiceErrorCode =
    | "INTEGRATION_INVALID_INPUT"
    | "INTEGRATION_ENCRYPTION_UNAVAILABLE";

const statusByCode: Record<IntegrationServiceErrorCode, 400 | 503> = {
    INTEGRATION_INVALID_INPUT: 400,
    INTEGRATION_ENCRYPTION_UNAVAILABLE: 503,
};

export class IntegrationServiceError extends Error {
    readonly status: 400 | 503;

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

const toStatus = (updatedAt: string | null): OpenRouterIntegrationStatus => ({
    provider: openRouterProvider,
    configured: updatedAt !== null,
    model: openRouterEmbeddingModel,
    dimensions: openRouterEmbeddingDimensions,
    updatedAt,
});

export const getOpenRouterIntegrationStatus = async (
    db: D1Database,
): Promise<OpenRouterIntegrationStatus> => {
    const credential = await getOpenRouterCredential(db);
    return toStatus(credential?.updatedAt ?? null);
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
            parsed.error.issues[0]?.message ?? "API key を確認してください。",
        );
    }
    const encrypted = await encryptApiKey(parsed.data.apiKey, encryptionSecret);
    const now = new Date().toISOString();
    await upsertOpenRouterCredential(db, {
        ...encrypted,
        createdAt: now,
        updatedAt: now,
    });
    return toStatus(now);
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
    const parsed =
        openRouterIntegrationUpdateSchema.shape.apiKey.safeParse(apiKey);
    if (!parsed.success) {
        throw new Error("Stored OpenRouter credential is invalid");
    }
    return parsed.data;
};
