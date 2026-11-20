import { calculateUnitPrice, canonicalUtcDateTime } from "../domain/price";
import {
    decodePriceResearchCursor,
    encodePriceResearchCursor,
    type PriceResearchCompleteInput,
    type PriceResearchCreateInput,
    type PriceResearchListOutput,
    type PriceResearchListQuery,
    type PriceResearchRequestDto,
    priceResearchCompleteSchema,
    priceResearchCreateSchema,
    priceResearchListQuerySchema,
} from "../domain/priceResearch";
import { getItem as getItemRecord } from "../repositories/itemRepository";
import {
    findPriceResearchRequestById,
    insertPriceResearchRequest,
    listPriceResearchRequests as listPriceResearchRequestRows,
    markPriceResearchCancelled,
    markPriceResearchCompleted,
    type PriceResearchRequestRow,
} from "../repositories/priceResearchRepository";
import { createItem, ItemServiceError } from "./itemService";
import {
    createPriceRecord,
    type PriceEnv,
    PriceServiceError,
} from "./priceService";

export type PriceResearchEnv = PriceEnv;

export type PriceResearchServiceErrorCode =
    | "PRICE_RESEARCH_INVALID_INPUT"
    | "PRICE_RESEARCH_INVALID_CURSOR"
    | "PRICE_RESEARCH_NOT_FOUND"
    | "PRICE_RESEARCH_ITEM_NOT_FOUND"
    | "PRICE_RESEARCH_STORE_NOT_FOUND"
    | "PRICE_RESEARCH_CONFLICT";

const statusByCode: Record<PriceResearchServiceErrorCode, 400 | 404 | 409> = {
    PRICE_RESEARCH_INVALID_INPUT: 400,
    PRICE_RESEARCH_INVALID_CURSOR: 400,
    PRICE_RESEARCH_NOT_FOUND: 404,
    PRICE_RESEARCH_ITEM_NOT_FOUND: 404,
    PRICE_RESEARCH_STORE_NOT_FOUND: 404,
    PRICE_RESEARCH_CONFLICT: 409,
};

export class PriceResearchServiceError extends Error {
    readonly status: 400 | 404 | 409;

    constructor(
        readonly code: PriceResearchServiceErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "PriceResearchServiceError";
        this.status = statusByCode[code];
    }
}

const invalidInput = (message: string): PriceResearchServiceError =>
    new PriceResearchServiceError("PRICE_RESEARCH_INVALID_INPUT", message);

const toDto = (row: PriceResearchRequestRow): PriceResearchRequestDto => {
    const item =
        row.itemId !== null &&
        row.itemName !== null &&
        row.itemBaseUnit !== null &&
        row.itemBaseDimension !== null
            ? {
                  id: row.itemId,
                  name: row.itemName,
                  baseUnit: row.itemBaseUnit,
                  baseDimension: row.itemBaseDimension,
              }
            : null;

    const priceRecord =
        row.priceRecordId !== null &&
        row.prPrice !== null &&
        row.prContentAmount !== null &&
        row.prSetCount !== null &&
        row.prBaseUnit !== null &&
        row.prBaseDimension !== null &&
        row.prSource !== null &&
        row.prRecordedAt !== null
            ? {
                  id: row.priceRecordId,
                  price: row.prPrice,
                  contentAmount: row.prContentAmount,
                  setCount: row.prSetCount,
                  baseUnit: row.prBaseUnit,
                  baseDimension: row.prBaseDimension,
                  unitPrice: calculateUnitPrice(
                      row.prPrice,
                      row.prContentAmount,
                      row.prSetCount,
                      row.prBaseDimension,
                      row.prBaseUnit,
                  ),
                  storeId: row.prStoreId,
                  storeName: row.prStoreName,
                  source: row.prSource,
                  packaging: row.prPackaging,
                  url: row.prUrl,
                  recordedAt: canonicalUtcDateTime(row.prRecordedAt),
              }
            : null;

    return {
        id: row.id,
        status: row.status,
        itemId: row.itemId,
        requestedItemName: row.requestedItemName,
        requestedUnit: row.requestedUnit,
        purpose: row.purpose,
        note: row.note,
        requestedBy: row.requestedBy,
        priceRecordId: row.priceRecordId,
        completedAt:
            row.completedAt !== null
                ? canonicalUtcDateTime(row.completedAt)
                : null,
        createdAt: canonicalUtcDateTime(row.createdAt),
        updatedAt: canonicalUtcDateTime(row.updatedAt),
        item,
        priceRecord,
    };
};

const mapItemError = (error: ItemServiceError): PriceResearchServiceError => {
    if (error.status === 404) {
        return new PriceResearchServiceError(
            "PRICE_RESEARCH_ITEM_NOT_FOUND",
            error.message,
        );
    }
    if (error.status === 409) {
        return new PriceResearchServiceError(
            "PRICE_RESEARCH_CONFLICT",
            error.message,
        );
    }
    return invalidInput(error.message);
};

const mapPriceError = (error: PriceServiceError): PriceResearchServiceError => {
    if (error.code === "PRICE_STORE_NOT_FOUND") {
        return new PriceResearchServiceError(
            "PRICE_RESEARCH_STORE_NOT_FOUND",
            error.message,
        );
    }
    if (error.code === "PRICE_ITEM_NOT_FOUND") {
        return new PriceResearchServiceError(
            "PRICE_RESEARCH_ITEM_NOT_FOUND",
            error.message,
        );
    }
    return invalidInput(error.message);
};

export const createPriceResearchRequest = async (
    env: PriceResearchEnv,
    input: unknown,
): Promise<PriceResearchRequestDto> => {
    const parsedResult = priceResearchCreateSchema.safeParse(input);
    if (!parsedResult.success) {
        throw invalidInput("価格調査依頼の入力値を確認してください");
    }
    const parsed: PriceResearchCreateInput = parsedResult.data;

    let itemId: string | null = null;
    let requestedItemName = parsed.requestedItemName ?? "";
    let requestedUnit = parsed.requestedUnit ?? null;

    if (parsed.itemId !== undefined) {
        const item = await getItemRecord(env.DB, parsed.itemId);
        if (!item) {
            throw new PriceResearchServiceError(
                "PRICE_RESEARCH_ITEM_NOT_FOUND",
                "指定された品目が見つかりません",
            );
        }
        itemId = item.id;
        requestedItemName = parsed.requestedItemName ?? item.name;
        if (parsed.requestedUnit === undefined) {
            requestedUnit = item.baseUnit;
        }
    }

    const created = await insertPriceResearchRequest(env.DB, {
        itemId,
        requestedItemName,
        requestedUnit,
        purpose: parsed.purpose ?? null,
        note: parsed.note ?? null,
        requestedBy: parsed.requestedBy ?? null,
    });
    return toDto(created);
};

export const listPriceResearchRequests = async (
    env: PriceResearchEnv,
    input: unknown = {},
): Promise<PriceResearchListOutput> => {
    const parsedResult = priceResearchListQuerySchema.safeParse(input);
    if (!parsedResult.success) {
        throw invalidInput("status、limit、cursorを確認してください");
    }
    const parsed: PriceResearchListQuery = parsedResult.data;

    const cursor = parsed.cursor
        ? decodePriceResearchCursor(parsed.cursor)
        : null;
    if (parsed.cursor && !cursor) {
        throw new PriceResearchServiceError(
            "PRICE_RESEARCH_INVALID_CURSOR",
            "価格調査依頼のcursorが不正です",
        );
    }

    const page = await listPriceResearchRequestRows(env.DB, {
        status: parsed.status,
        limit: parsed.limit,
        cursor,
    });

    const items = page.rows.map(toDto);
    const last = items.at(-1);
    return {
        items,
        nextCursor:
            page.hasMore && last
                ? encodePriceResearchCursor({
                      createdAt: last.createdAt,
                      id: last.id,
                  })
                : null,
    };
};

export const completePriceResearchRequest = async (
    env: PriceResearchEnv,
    id: string,
    input: unknown,
): Promise<PriceResearchRequestDto> => {
    if (id.trim().length === 0) {
        throw invalidInput("idを指定してください");
    }
    const parsedResult = priceResearchCompleteSchema.safeParse(input);
    if (!parsedResult.success) {
        throw invalidInput("価格登録の入力値を確認してください");
    }
    const parsed: PriceResearchCompleteInput = parsedResult.data;

    const existing = await findPriceResearchRequestById(env.DB, id);
    if (!existing) {
        throw new PriceResearchServiceError(
            "PRICE_RESEARCH_NOT_FOUND",
            "指定された価格調査依頼が見つかりません",
        );
    }
    if (existing.status !== "pending") {
        throw new PriceResearchServiceError(
            "PRICE_RESEARCH_CONFLICT",
            "未調査の価格調査依頼のみ完了できます",
        );
    }

    let targetItemId: string;
    if (existing.itemId !== null) {
        if (parsed.newItem !== undefined) {
            throw invalidInput(
                "すでに品目が紐付いているため新規品目は指定できません",
            );
        }
        if (parsed.itemId !== undefined && parsed.itemId !== existing.itemId) {
            throw invalidInput(
                "すでに品目が紐付いているため別の品目は指定できません",
            );
        }
        targetItemId = existing.itemId;
    } else if (parsed.itemId !== undefined) {
        const item = await getItemRecord(env.DB, parsed.itemId);
        if (!item) {
            throw new PriceResearchServiceError(
                "PRICE_RESEARCH_ITEM_NOT_FOUND",
                "指定された品目が見つかりません",
            );
        }
        targetItemId = item.id;
    } else if (parsed.newItem !== undefined) {
        try {
            const createdItem = await createItem(env.DB, parsed.newItem);
            targetItemId = createdItem.id;
        } catch (error) {
            if (error instanceof ItemServiceError) {
                throw mapItemError(error);
            }
            throw error;
        }
    } else {
        throw invalidInput("品目を選択するか、新しい品目を作成してください");
    }

    let priceRecordId: string;
    try {
        const priceRecord = await createPriceRecord(env, {
            itemId: targetItemId,
            contentAmount: parsed.contentAmount,
            contentUnit: parsed.contentUnit,
            setCount: parsed.setCount,
            price: parsed.price,
            storeId: parsed.storeId,
            packaging: parsed.packaging ?? null,
            url: parsed.url ?? null,
            recordedAt: parsed.recordedAt ?? new Date().toISOString(),
        });
        priceRecordId = priceRecord.id;
    } catch (error) {
        if (error instanceof PriceServiceError) {
            throw mapPriceError(error);
        }
        throw error;
    }

    const updated = await markPriceResearchCompleted(env.DB, id, {
        itemId: targetItemId,
        priceRecordId,
        completedAt: new Date().toISOString(),
    });
    if (!updated) {
        throw new PriceResearchServiceError(
            "PRICE_RESEARCH_CONFLICT",
            "価格調査依頼の状態が変更されました",
        );
    }
    return toDto(updated);
};

export const cancelPriceResearchRequest = async (
    env: PriceResearchEnv,
    id: string,
): Promise<PriceResearchRequestDto> => {
    if (id.trim().length === 0) {
        throw invalidInput("idを指定してください");
    }
    const existing = await findPriceResearchRequestById(env.DB, id);
    if (!existing) {
        throw new PriceResearchServiceError(
            "PRICE_RESEARCH_NOT_FOUND",
            "指定された価格調査依頼が見つかりません",
        );
    }
    if (existing.status !== "pending") {
        throw new PriceResearchServiceError(
            "PRICE_RESEARCH_CONFLICT",
            "未調査の価格調査依頼のみキャンセルできます",
        );
    }
    const updated = await markPriceResearchCancelled(env.DB, id);
    if (!updated) {
        throw new PriceResearchServiceError(
            "PRICE_RESEARCH_CONFLICT",
            "価格調査依頼の状態が変更されました",
        );
    }
    return toDto(updated);
};
