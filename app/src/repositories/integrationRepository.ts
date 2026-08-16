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
