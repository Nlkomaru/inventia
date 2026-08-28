import { z } from "zod";
import {
    type OpenRouterChatModelList,
    type OpenRouterChatModelOption,
    type OpenRouterIntegrationStatus,
    type OpenRouterUsageByModel,
    type OpenRouterUsageSummary,
    openRouterApiKeySchema,
    openRouterChatModelSchema,
    openRouterDefaultChatModel,
    openRouterEmbeddingDimensions,
    openRouterEmbeddingModel,
    openRouterIntegrationUpdateSchema,
    openRouterProvider,
} from "../domain/integration";
import { receiptParseDefaultInstructions } from "../domain/receipt";
import {
    getOpenRouterCredential,
    getOpenRouterSettings,
    type IntegrationSettingsRecord,
    upsertOpenRouterCredential,
    upsertOpenRouterSettings,
} from "../repositories/integrationRepository";

export type IntegrationServiceErrorCode =
    | "INTEGRATION_INVALID_INPUT"
    | "INTEGRATION_PROVIDER_ERROR"
    | "INTEGRATION_ENCRYPTION_UNAVAILABLE"
    | "INTEGRATION_MANAGEMENT_KEY_UNAVAILABLE"
    | "INTEGRATION_WORKSPACE_UNAVAILABLE";

const statusByCode: Record<IntegrationServiceErrorCode, 400 | 502 | 503> = {
    INTEGRATION_INVALID_INPUT: 400,
    INTEGRATION_PROVIDER_ERROR: 502,
    INTEGRATION_ENCRYPTION_UNAVAILABLE: 503,
    INTEGRATION_MANAGEMENT_KEY_UNAVAILABLE: 503,
    INTEGRATION_WORKSPACE_UNAVAILABLE: 503,
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
            "連携設定を保存できません。SETTINGS_ENCRYPTION_KEY が未設定または32バイトのBase64形式ではありません。",
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
    settings: IntegrationSettingsRecord | null,
): OpenRouterIntegrationStatus => ({
    provider: openRouterProvider,
    configured: credentialUpdatedAt !== null,
    model: openRouterEmbeddingModel,
    dimensions: openRouterEmbeddingDimensions,
    chatModel: settings?.chatModel ?? openRouterDefaultChatModel,
    chatModelConfigured: settings !== null,
    // 解析へ渡る実効値を返す。未設定なら既定の指示がそのまま入る
    receiptPrompt: settings?.receiptPrompt ?? receiptParseDefaultInstructions,
    receiptPromptConfigured: settings?.receiptPrompt != null,
    updatedAt: credentialUpdatedAt,
});

/**
 * 既定と同じ内容は保存しない。保存してしまうと既定の指示を改善しても
 * 一度保存した利用者へ届かなくなる。
 */
const normalizeReceiptPrompt = (value: string | null): string | null => {
    if (value === null) {
        return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === receiptParseDefaultInstructions) {
        return null;
    }
    return trimmed;
};

export const getOpenRouterIntegrationStatus = async (
    db: D1Database,
): Promise<OpenRouterIntegrationStatus> => {
    const [credential, settings] = await Promise.all([
        getOpenRouterCredential(db),
        getOpenRouterSettings(db),
    ]);
    return toStatus(credential?.updatedAt ?? null, settings);
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
    const { apiKey, chatModel, receiptPrompt } = parsed.data;
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
    if (chatModel !== undefined || receiptPrompt !== undefined) {
        // 1 行を丸ごと書き戻すため、渡されなかった項目は保存済みの値を引き継ぐ
        const current = await getOpenRouterSettings(db);
        await upsertOpenRouterSettings(db, {
            chatModel:
                chatModel ?? current?.chatModel ?? openRouterDefaultChatModel,
            receiptPrompt:
                receiptPrompt === undefined
                    ? (current?.receiptPrompt ?? null)
                    : normalizeReceiptPrompt(receiptPrompt),
            // 列は残っているが解析へ渡す tool は常時有効のため、保存済みの値をそのまま戻す
            receiptToolsEnabled: current?.receiptToolsEnabled ?? false,
            createdAt: current?.createdAt ?? now,
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

export interface OpenRouterUsageEnv {
    // Wrangler secret。生成型は wrangler.jsonc の binding だけを表すため、
    // service が必要とする任意の構造型で受ける
    OPENROUTER_MANAGEMENT_KEY?: string;
}

const openRouterWorkspaceSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    slug: z.string().min(1),
});

const openRouterWorkspaceEnvelopeSchema = z.object({
    data: z.array(openRouterWorkspaceSchema),
});

const openRouterActivityEntrySchema = z.object({
    model: z.string().min(1),
    provider_name: z.string().min(1),
    requests: z.int().nonnegative(),
    prompt_tokens: z.int().nonnegative(),
    completion_tokens: z.int().nonnegative(),
    reasoning_tokens: z.int().nonnegative().optional().default(0),
    usage: z.number().nonnegative(),
});

const openRouterActivityEnvelopeSchema = z.object({
    data: z.array(openRouterActivityEntrySchema),
});

const managementKeyUnavailable = () =>
    new IntegrationServiceError(
        "INTEGRATION_MANAGEMENT_KEY_UNAVAILABLE",
        "OpenRouter の利用量を取得できません。管理者が OPENROUTER_MANAGEMENT_KEY を設定してください。",
    );

const workspaceUnavailable = () =>
    new IntegrationServiceError(
        "INTEGRATION_WORKSPACE_UNAVAILABLE",
        "OpenRouter に inventia workspace が見つかりません。",
    );

const usageProviderError = () =>
    new IntegrationServiceError(
        "INTEGRATION_PROVIDER_ERROR",
        "OpenRouter から利用量を取得できませんでした。時間をおいて再試行してください。",
    );

const fetchOpenRouterJson = async (
    url: string,
    managementKey: string,
    fetcher: typeof fetch,
): Promise<unknown> => {
    let response: Response;
    try {
        response = await fetcher(url, {
            headers: {
                accept: "application/json",
                authorization: `Bearer ${managementKey}`,
            },
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            throw usageProviderError();
        }
        return await response.json();
    } catch (error) {
        if (error instanceof IntegrationServiceError) {
            throw error;
        }
        throw usageProviderError();
    }
};

/**
 * OpenRouter Activity API の inventia workspace における直近 30 完了 UTC 日を、
 * モデルと provider 単位に集約する。
 * management key は Worker secret だけで使い、ブラウザや API 応答へ返さない。
 */
export const getOpenRouterUsage = async (
    env: OpenRouterUsageEnv,
    fetcher: typeof fetch = fetch,
): Promise<OpenRouterUsageSummary> => {
    const managementKey = env.OPENROUTER_MANAGEMENT_KEY;
    if (!managementKey) {
        throw managementKeyUnavailable();
    }
    const workspacePayload = await fetchOpenRouterJson(
        "https://openrouter.ai/api/v1/workspaces?limit=100",
        managementKey,
        fetcher,
    );
    const workspaces =
        openRouterWorkspaceEnvelopeSchema.safeParse(workspacePayload);
    if (!workspaces.success) {
        throw usageProviderError();
    }
    const workspace = workspaces.data.data.find(
        (candidate) =>
            candidate.slug.toLowerCase() === "inventia" ||
            candidate.name.toLowerCase() === "inventia",
    );
    if (!workspace) {
        throw workspaceUnavailable();
    }
    const activityPayload = await fetchOpenRouterJson(
        `https://openrouter.ai/api/v1/activity?group_by=workspace&workspace_id=${encodeURIComponent(workspace.id)}`,
        managementKey,
        fetcher,
    );
    const activity =
        openRouterActivityEnvelopeSchema.safeParse(activityPayload);
    if (!activity.success) {
        throw usageProviderError();
    }

    const modelsByName = new Map<string, Map<string, OpenRouterUsageByModel>>();
    for (const entry of activity.data.data) {
        const providers = modelsByName.get(entry.model) ?? new Map();
        const existing = providers.get(entry.provider_name);
        providers.set(entry.provider_name, {
            model: entry.model,
            providerName: entry.provider_name,
            requestCount: (existing?.requestCount ?? 0) + entry.requests,
            promptTokens: (existing?.promptTokens ?? 0) + entry.prompt_tokens,
            completionTokens:
                (existing?.completionTokens ?? 0) + entry.completion_tokens,
            reasoningTokens:
                (existing?.reasoningTokens ?? 0) + entry.reasoning_tokens,
            totalTokens:
                (existing?.totalTokens ?? 0) +
                entry.prompt_tokens +
                entry.completion_tokens,
            cost: (existing?.cost ?? 0) + entry.usage,
        });
        modelsByName.set(entry.model, providers);
    }
    const models = [...modelsByName.values()]
        .flatMap((providers) => [...providers.values()])
        .sort(
            (left, right) =>
                right.totalTokens - left.totalTokens ||
                left.model.localeCompare(right.model) ||
                left.providerName.localeCompare(right.providerName),
        );
    const summary: OpenRouterUsageSummary = {
        periodDays: 30,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        cost: 0,
        models,
    };
    for (const model of models) {
        summary.requestCount += model.requestCount;
        summary.promptTokens += model.promptTokens;
        summary.completionTokens += model.completionTokens;
        summary.reasoningTokens += model.reasoningTokens;
        summary.totalTokens += model.totalTokens;
        summary.cost += model.cost;
    }
    return summary;
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
