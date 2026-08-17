import { openRouterProvider } from "../domain/integration";

export interface IntegrationCredentialRecord {
    provider: typeof openRouterProvider;
    ciphertext: string;
    initializationVector: string;
    encryptionVersion: 1;
    createdAt: string;
    updatedAt: string;
}

interface IntegrationCredentialRow {
    provider: string;
    ciphertext: string;
    initializationVector: string;
    encryptionVersion: number;
    createdAt: string;
    updatedAt: string;
}

const toCredentialRecord = (
    row: IntegrationCredentialRow,
): IntegrationCredentialRecord | null => {
    if (row.provider !== openRouterProvider || row.encryptionVersion !== 1) {
        return null;
    }
    return {
        provider: openRouterProvider,
        ciphertext: row.ciphertext,
        initializationVector: row.initializationVector,
        encryptionVersion: 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
};

export interface IntegrationSettingsRecord {
    provider: typeof openRouterProvider;
    chatModel: string;
    createdAt: string;
    updatedAt: string;
}

interface IntegrationSettingsRow {
    provider: string;
    chatModel: string;
    createdAt: string;
    updatedAt: string;
}

const toSettingsRecord = (
    row: IntegrationSettingsRow,
): IntegrationSettingsRecord | null => {
    if (row.provider !== openRouterProvider || row.chatModel.length === 0) {
        return null;
    }
    return {
        provider: openRouterProvider,
        chatModel: row.chatModel,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
};

export const getOpenRouterCredential = async (
    db: D1Database,
): Promise<IntegrationCredentialRecord | null> => {
    const row = await db
        .prepare(
            `SELECT
                provider,
                ciphertext,
                initialization_vector AS initializationVector,
                encryption_version AS encryptionVersion,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM integration_credentials
            WHERE provider = ?1`,
        )
        .bind(openRouterProvider)
        .first<IntegrationCredentialRow>();
    return row ? toCredentialRecord(row) : null;
};

export const upsertOpenRouterCredential = async (
    db: D1Database,
    credential: Omit<
        IntegrationCredentialRecord,
        "provider" | "encryptionVersion" | "createdAt"
    > & { createdAt: string },
): Promise<void> => {
    await db
        .prepare(
            `INSERT INTO integration_credentials (
                provider,
                ciphertext,
                initialization_vector,
                encryption_version,
                created_at,
                updated_at
            ) VALUES (?1, ?2, ?3, 1, ?4, ?5)
            ON CONFLICT(provider) DO UPDATE SET
                ciphertext = excluded.ciphertext,
                initialization_vector = excluded.initialization_vector,
                encryption_version = excluded.encryption_version,
                updated_at = excluded.updated_at`,
        )
        .bind(
            openRouterProvider,
            credential.ciphertext,
            credential.initializationVector,
            credential.createdAt,
            credential.updatedAt,
        )
        .run();
};

// 認証情報とは別テーブル。API key 未設定でもモデル選択だけ保存できる。
export const getOpenRouterSettings = async (
    db: D1Database,
): Promise<IntegrationSettingsRecord | null> => {
    const row = await db
        .prepare(
            `SELECT
                provider,
                chat_model AS chatModel,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM integration_settings
            WHERE provider = ?1`,
        )
        .bind(openRouterProvider)
        .first<IntegrationSettingsRow>();
    return row ? toSettingsRecord(row) : null;
};

export const upsertOpenRouterSettings = async (
    db: D1Database,
    settings: Omit<IntegrationSettingsRecord, "provider">,
): Promise<void> => {
    await db
        .prepare(
            `INSERT INTO integration_settings (
                provider,
                chat_model,
                created_at,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(provider) DO UPDATE SET
                chat_model = excluded.chat_model,
                updated_at = excluded.updated_at`,
        )
        .bind(
            openRouterProvider,
            settings.chatModel,
            settings.createdAt,
            settings.updatedAt,
        )
        .run();
};
