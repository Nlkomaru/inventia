import {
    type ExternalProviderCreateInput,
    type ExternalProviderDto,
    type ExternalProviderId,
    type ExternalProviderList,
    type ExternalProviderUpdateInput,
    externalProviderCreateInputSchema,
    externalProviderIdSchema,
    externalProviderUpdateInputSchema,
} from "../domain/externalProvider";
import { newId } from "../domain/id";
import {
    countStockMovementsByExternalProvider,
    deleteExternalProvider as deleteExternalProviderRow,
    type ExternalProviderRow,
    findExternalProviderById,
    findExternalProviderByName,
    insertExternalProvider,
    listExternalProviders as listExternalProviderRows,
    updateExternalProvider as updateExternalProviderRow,
} from "../repositories/externalProviderRepository";

export type ExternalProviderServiceErrorCode =
    | "EXTERNAL_PROVIDER_INVALID_INPUT"
    | "EXTERNAL_PROVIDER_NOT_FOUND"
    | "EXTERNAL_PROVIDER_NAME_CONFLICT"
    | "EXTERNAL_PROVIDER_IN_USE";

const statusByCode: Record<ExternalProviderServiceErrorCode, 400 | 404 | 409> =
    {
        EXTERNAL_PROVIDER_INVALID_INPUT: 400,
        EXTERNAL_PROVIDER_NOT_FOUND: 404,
        EXTERNAL_PROVIDER_NAME_CONFLICT: 409,
        EXTERNAL_PROVIDER_IN_USE: 409,
    };

export class ExternalProviderServiceError extends Error {
    readonly status: 400 | 404 | 409;

    constructor(
        readonly code: ExternalProviderServiceErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "ExternalProviderServiceError";
        this.status = statusByCode[code];
    }
}

const invalidInput = (message: string): ExternalProviderServiceError =>
    new ExternalProviderServiceError(
        "EXTERNAL_PROVIDER_INVALID_INPUT",
        message,
    );

const isConstraintViolation = (error: unknown): boolean =>
    /constraint|unique/i.test(
        error instanceof Error ? error.message : String(error),
    );

const nameConflict = (): ExternalProviderServiceError =>
    new ExternalProviderServiceError(
        "EXTERNAL_PROVIDER_NAME_CONFLICT",
        "同じ名前の連携先が既に存在します",
    );

const notFound = (): ExternalProviderServiceError =>
    new ExternalProviderServiceError(
        "EXTERNAL_PROVIDER_NOT_FOUND",
        "指定された連携先が見つかりません",
    );

const parseProviderId = (id: unknown): ExternalProviderId => {
    const result = externalProviderIdSchema.safeParse(id);
    if (!result.success) {
        throw invalidInput("連携先IDを確認してください");
    }
    return result.data;
};

const parseCreateInput = (input: unknown): ExternalProviderCreateInput => {
    const result = externalProviderCreateInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput(
            result.error.issues[0]?.message ??
                "連携先の名前とURLを確認してください",
        );
    }
    return result.data;
};

const parseUpdateInput = (input: unknown): ExternalProviderUpdateInput => {
    const result = externalProviderUpdateInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput(
            result.error.issues[0]?.message ??
                "更新する連携先の名前とURLを確認してください",
        );
    }
    return result.data;
};

const toDto = (row: ExternalProviderRow): ExternalProviderDto => ({
    id: row.id,
    name: row.name,
    faviconUrl: row.faviconUrl,
    url: row.url,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const requireProvider = async (
    db: D1Database,
    id: ExternalProviderId,
): Promise<ExternalProviderRow> => {
    const row = await findExternalProviderById(db, id);
    if (!row) {
        throw notFound();
    }
    return row;
};

export const listExternalProviders = async (
    db: D1Database,
): Promise<ExternalProviderList> => ({
    providers: (await listExternalProviderRows(db)).map(toDto),
});

export const getExternalProvider = async (
    db: D1Database,
    id: unknown,
): Promise<ExternalProviderDto> =>
    toDto(await requireProvider(db, parseProviderId(id)));

/**
 * 在庫操作から連携先の指定を検証するための存在確認。DTO を組み立てずに
 * 済ませたい呼び出し元のために、真偽だけを返す形で公開する。
 */
export const externalProviderExists = async (
    db: D1Database,
    id: ExternalProviderId,
): Promise<boolean> => (await findExternalProviderById(db, id)) !== null;

export const createExternalProvider = async (
    db: D1Database,
    input: unknown,
): Promise<ExternalProviderDto> => {
    const parsed = parseCreateInput(input);
    if (await findExternalProviderByName(db, parsed.name)) {
        throw nameConflict();
    }
    const now = new Date().toISOString();
    try {
        return toDto(
            await insertExternalProvider(db, {
                id: newId(),
                name: parsed.name,
                faviconUrl: parsed.faviconUrl,
                url: parsed.url,
                createdAt: now,
                updatedAt: now,
            }),
        );
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw nameConflict();
        }
        throw error;
    }
};

export const updateExternalProvider = async (
    db: D1Database,
    id: unknown,
    input: unknown,
): Promise<ExternalProviderDto> => {
    const providerId = parseProviderId(id);
    const parsed = parseUpdateInput(input);
    await requireProvider(db, providerId);
    if (parsed.name !== undefined) {
        const duplicate = await findExternalProviderByName(db, parsed.name);
        if (duplicate && duplicate.id !== providerId) {
            throw nameConflict();
        }
    }
    let row: ExternalProviderRow | null;
    try {
        row = await updateExternalProviderRow(
            db,
            providerId,
            parsed,
            new Date().toISOString(),
        );
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw nameConflict();
        }
        throw error;
    }
    if (!row) {
        throw notFound();
    }
    return toDto(row);
};

export const deleteExternalProvider = async (
    db: D1Database,
    id: unknown,
): Promise<void> => {
    const providerId = parseProviderId(id);
    await requireProvider(db, providerId);
    // stock_movements は ON DELETE RESTRICT で参照するため、先に理由を返す
    if ((await countStockMovementsByExternalProvider(db, providerId)) > 0) {
        throw new ExternalProviderServiceError(
            "EXTERNAL_PROVIDER_IN_USE",
            "在庫履歴が参照しているため削除できません。先に在庫履歴の連携先を変更してください",
        );
    }
    try {
        if (!(await deleteExternalProviderRow(db, providerId))) {
            throw notFound();
        }
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw new ExternalProviderServiceError(
                "EXTERNAL_PROVIDER_IN_USE",
                "参照中のため削除できません。先に参照を解除してください",
            );
        }
        throw error;
    }
};

export type { ExternalProviderRow };
