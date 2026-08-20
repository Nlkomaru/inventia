import {
    openRouterDefaultEmojiModel,
    openRouterProvider,
} from "../domain/integration";

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
    /** null は既定の指示を使うことを表す。 */
    receiptPrompt: string | null;
    receiptToolsEnabled: boolean;
    /** 品目の絵文字を生成するモデル。未保存の行では既定の ID を返す。 */
    emojiModel: string;
    createdAt: string;
    updatedAt: string;
}

interface IntegrationSettingsRow {
    provider: string;
    chatModel: string;
    receiptPrompt: string | null;
    // SQLite に真偽値型が無いため 0 / 1 で読み書きする
    receiptToolsEnabled: number;
    emojiModel: string | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * 絵文字モデルだけを省略できる書き込み。既存の呼び出し元は絵文字を扱わないため、
 * 省略時は保存済みの値（無ければ既定）を保つ。
 */
export type IntegrationSettingsWrite = Omit<
    IntegrationSettingsRecord,
    "provider" | "emojiModel"
> & { emojiModel?: string };

const toSettingsRecord = (
    row: IntegrationSettingsRow,
): IntegrationSettingsRecord | null => {
    if (row.provider !== openRouterProvider || row.chatModel.length === 0) {
        return null;
    }
    return {
        provider: openRouterProvider,
        chatModel: row.chatModel,
        receiptPrompt:
            row.receiptPrompt !== null && row.receiptPrompt.length > 0
                ? row.receiptPrompt
                : null,
        receiptToolsEnabled: row.receiptToolsEnabled !== 0,
        emojiModel:
            row.emojiModel !== null && row.emojiModel.length > 0
                ? row.emojiModel
                : openRouterDefaultEmojiModel,
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
                receipt_prompt AS receiptPrompt,
                receipt_tools_enabled AS receiptToolsEnabled,
                emoji_model AS emojiModel,
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
    settings: IntegrationSettingsWrite,
): Promise<void> => {
    await db
        .prepare(
            `INSERT INTO integration_settings (
                provider,
                chat_model,
                receipt_prompt,
                receipt_tools_enabled,
                emoji_model,
                created_at,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, coalesce(?5, ?6), ?7, ?8)
            ON CONFLICT(provider) DO UPDATE SET
                chat_model = excluded.chat_model,
                receipt_prompt = excluded.receipt_prompt,
                receipt_tools_enabled = excluded.receipt_tools_enabled,
                -- 絵文字モデルを渡さない呼び出しでは保存済みの値を残す
                emoji_model = coalesce(?5, integration_settings.emoji_model),
                updated_at = excluded.updated_at`,
        )
        .bind(
            openRouterProvider,
            settings.chatModel,
            settings.receiptPrompt,
            settings.receiptToolsEnabled ? 1 : 0,
            settings.emojiModel ?? null,
            openRouterDefaultEmojiModel,
            settings.createdAt,
            settings.updatedAt,
        )
        .run();
};
