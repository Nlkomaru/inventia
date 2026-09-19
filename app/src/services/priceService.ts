import {
    type AllPriceRecordDto,
    type AllPriceRecordListInput,
    allPriceRecordListInputSchema,
    calculateUnitPrice,
    canonicalUtcDateTime,
    decodeAllPriceRecordCursor,
    decodePriceComparisonCursor,
    decodePriceRecordCursor,
    encodeAllPriceRecordCursor,
    encodePriceComparisonCursor,
    encodePriceRecordCursor,
    normalizeContentAmount,
    type PriceBatchOutput,
    type PriceComparisonListInput,
    type PriceRecordCreateInput,
    type PriceRecordDto,
    type PriceRecordListInput,
    type PriceRecordUpdateInput,
    priceBatchInputSchema,
    priceComparisonListInputSchema,
    priceRecordCreateInputSchema,
    priceRecordListInputSchema,
    priceRecordUpdateInputSchema,
} from "../domain/price";
import { storeFaviconPath } from "../domain/store";
import {
    type AllPriceRecordRow,
    findItemPricingContext,
    findPriceRecordById,
    insertPriceRecord,
    listAllPriceRecords as listAllPriceRecordRows,
    listPriceRecords as listPriceRecordRows,
    listPriceRecordsByUnitPrice,
    type PriceComparisonRecordRow,
    type PriceRecordRow,
    updatePriceRecord as updatePriceRecordRow,
} from "../repositories/priceRepository";
import { findStoreById } from "../repositories/storeRepository";
import { type SignedImageUrlEnv, signImageUrl } from "./signedImageUrlService";

/** 価格記録は店舗のファビコン URL に署名するため、D1 に加えて署名鍵の元が要る。 */
export interface PriceEnv extends SignedImageUrlEnv {
    DB: D1Database;
}

export type PriceServiceErrorCode =
    | "PRICE_INVALID_INPUT"
    | "PRICE_INVALID_CURSOR"
    | "PRICE_ITEM_NOT_FOUND"
    | "PRICE_RECORD_NOT_FOUND"
    | "PRICE_STORE_NOT_FOUND";

const statusByCode: Record<PriceServiceErrorCode, 400 | 404> = {
    PRICE_INVALID_INPUT: 400,
    PRICE_INVALID_CURSOR: 400,
    PRICE_ITEM_NOT_FOUND: 404,
    PRICE_RECORD_NOT_FOUND: 404,
    PRICE_STORE_NOT_FOUND: 404,
};

export class PriceServiceError extends Error {
    readonly status: 400 | 404;

    constructor(
        readonly code: PriceServiceErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "PriceServiceError";
        this.status = statusByCode[code];
    }
}

const invalidInput = (message: string): PriceServiceError =>
    new PriceServiceError("PRICE_INVALID_INPUT", message);

const parseCreateInput = (input: unknown): PriceRecordCreateInput => {
    const result = priceRecordCreateInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("価格履歴の入力値を確認してください");
    }
    return {
        ...result.data,
        recordedAt: canonicalUtcDateTime(result.data.recordedAt),
    };
};

const parseUpdateInput = (input: unknown): PriceRecordUpdateInput => {
    const result = priceRecordUpdateInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("価格履歴の入力値を確認してください");
    }
    return result.data;
};

const parseListInput = (input: unknown): PriceRecordListInput => {
    const result = priceRecordListInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("itemId、limit、cursorを確認してください");
    }
    return result.data;
};

const parseAllListInput = (input: unknown): AllPriceRecordListInput => {
    const result = allPriceRecordListInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("limit、cursorを確認してください");
    }
    return result.data;
};

const parseComparisonInput = (input: unknown): PriceComparisonListInput => {
    const result = priceComparisonListInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("itemId、limit、cursorを確認してください");
    }
    return result.data;
};

const toDto = (
    env: SignedImageUrlEnv,
    row: PriceRecordRow,
    unitPrice = calculateUnitPrice(
        row.price,
        row.contentAmount,
        row.setCount,
        row.baseDimension,
        row.baseUnit,
    ),
): PriceRecordDto => ({
    id: row.id,
    itemId: row.itemId,
    contentAmount: row.contentAmount,
    setCount: row.setCount,
    packaging: row.packaging,
    price: row.price,
    source: row.source,
    storeId: row.storeId,
    storeName: row.storeName,
    storeFaviconUrl:
        row.storeId !== null && row.storeFaviconObjectKey !== null
            ? signImageUrl(env, storeFaviconPath(row.storeId))
            : null,
    url: row.url,
    recordedAt: canonicalUtcDateTime(row.recordedAt),
    createdAt: canonicalUtcDateTime(row.createdAt),
    baseUnit: row.baseUnit,
    baseDimension: row.baseDimension,
    unitPrice,
});

const toAllDto = (
    env: SignedImageUrlEnv,
    row: AllPriceRecordRow,
): AllPriceRecordDto => ({
    ...toDto(env, row),
    itemName: row.itemName,
});

export type PriceRecordListResponse = {
    items: PriceRecordDto[];
    nextCursor: string | null;
};

export type AllPriceRecordListResponse = {
    items: AllPriceRecordDto[];
    nextCursor: string | null;
};

/**
 * 店舗参照と自由記述の取得元を解決し、内容量を品目の基準単位へ換算する。
 * 作成と訂正で同じ規則を使い、表示経路による単価のずれを防ぐ。
 */
const normalizeWritableInput = async (
    env: PriceEnv,
    item: Pick<PriceRecordRow, "baseUnit" | "baseDimension">,
    input: Pick<
        PriceRecordUpdateInput,
        | "contentAmount"
        | "contentUnit"
        | "setCount"
        | "packaging"
        | "price"
        | "source"
        | "storeId"
        | "url"
    >,
) => {
    const contentAmount = normalizeContentAmount(
        input.contentAmount,
        input.contentUnit,
        item.baseUnit,
        item.baseDimension,
    );
    if (contentAmount === null) {
        throw invalidInput(
            "内容量単位が商品の基準単位と互換性がないか、整数へ変換できません",
        );
    }
    const store =
        input.storeId === undefined || input.storeId === null
            ? null
            : await findStoreById(env.DB, input.storeId);
    if (input.storeId && !store) {
        throw new PriceServiceError(
            "PRICE_STORE_NOT_FOUND",
            "指定された店舗が見つかりません",
        );
    }
    const source = input.source ?? store?.name;
    if (source === undefined) {
        throw invalidInput(
            "店舗（storeId）か取得元（source）を指定してください",
        );
    }
    return {
        contentAmount,
        setCount: input.setCount,
        packaging: input.packaging ?? null,
        price: input.price,
        source,
        storeId: store?.id ?? null,
        url: input.url ?? null,
    };
};

export const createPriceRecord = async (
    env: PriceEnv,
    input: unknown,
): Promise<PriceRecordDto> => {
    const parsed = parseCreateInput(input);
    const item = await findItemPricingContext(env.DB, parsed.itemId);
    if (!item) {
        throw new PriceServiceError(
            "PRICE_ITEM_NOT_FOUND",
            "指定された商品が見つかりません",
        );
    }
    return toDto(
        env,
        await insertPriceRecord(env.DB, {
            ...(await normalizeWritableInput(env, item, parsed)),
            itemId: parsed.itemId,
            recordedAt: parsed.recordedAt,
        }),
    );
};

/**
 * 内容量・価格などの入力誤りを訂正する。観測日時は入力にも SQL の UPDATE にも
 * 含めず、履歴の順序と購入時点を保持する。
 */
export const updatePriceRecord = async (
    env: PriceEnv,
    priceRecordId: string,
    input: unknown,
): Promise<PriceRecordDto> => {
    const parsed = parseUpdateInput(input);
    const record = await findPriceRecordById(env.DB, priceRecordId);
    if (!record || record.itemId !== parsed.itemId) {
        throw new PriceServiceError(
            "PRICE_RECORD_NOT_FOUND",
            "指定された価格履歴が見つかりません",
        );
    }
    return toDto(
        env,
        await updatePriceRecordRow(
            env.DB,
            priceRecordId,
            await normalizeWritableInput(env, record, parsed),
        ),
    );
};

export const listPriceRecords = async (
    env: PriceEnv,
    input: unknown,
): Promise<PriceRecordListResponse> => {
    const parsed = parseListInput(input);
    const item = await findItemPricingContext(env.DB, parsed.itemId);
    if (!item) {
        throw new PriceServiceError(
            "PRICE_ITEM_NOT_FOUND",
            "指定された商品が見つかりません",
        );
    }
    const cursor = parsed.cursor
        ? decodePriceRecordCursor(parsed.cursor)
        : null;
    if (parsed.cursor && (!cursor || cursor.itemId !== parsed.itemId)) {
        throw new PriceServiceError(
            "PRICE_INVALID_CURSOR",
            "価格履歴のcursorが不正です",
        );
    }
    const page = await listPriceRecordRows(env.DB, {
        itemId: parsed.itemId,
        limit: parsed.limit,
        cursor,
    });
    // toDto の第 2 引数は単価で、既定は行から計算する。map へ関数をそのまま渡すと
    // 添字が単価として入るため、1 引数で呼ぶ
    const items = page.rows.map((row) => toDto(env, row));
    const last = items.at(-1);
    return {
        items,
        nextCursor:
            page.hasMore && last
                ? encodePriceRecordCursor({
                      itemId: parsed.itemId,
                      recordedAt: last.recordedAt,
                      id: last.id,
                  })
                : null,
    };
};

/**
 * 品目を跨いだ価格記録の一覧。品目で絞らないため cursor は記録日時と id だけを
 * 持ち、品目ごとの価格履歴の cursor とは互換性がない。
 */
export const listAllPriceRecords = async (
    env: PriceEnv,
    input: unknown,
): Promise<AllPriceRecordListResponse> => {
    const parsed = parseAllListInput(input);
    const cursor = parsed.cursor
        ? decodeAllPriceRecordCursor(parsed.cursor)
        : null;
    if (parsed.cursor && !cursor) {
        throw new PriceServiceError(
            "PRICE_INVALID_CURSOR",
            "価格一覧のcursorが不正です",
        );
    }
    const page = await listAllPriceRecordRows(env.DB, {
        limit: parsed.limit,
        cursor,
    });
    const items = page.rows.map((row) => toAllDto(env, row));
    const last = items.at(-1);
    return {
        items,
        nextCursor:
            page.hasMore && last
                ? encodeAllPriceRecordCursor({
                      recordedAt: last.recordedAt,
                      id: last.id,
                  })
                : null,
    };
};

export const compareUnitPrices = async (
    env: PriceEnv,
    input: unknown,
): Promise<PriceRecordListResponse> => {
    const parsed = parseComparisonInput(input);
    const item = await findItemPricingContext(env.DB, parsed.itemId);
    if (!item) {
        throw new PriceServiceError(
            "PRICE_ITEM_NOT_FOUND",
            "指定された商品が見つかりません",
        );
    }
    const cursor = parsed.cursor
        ? decodePriceComparisonCursor(parsed.cursor)
        : null;
    if (parsed.cursor && (!cursor || cursor.itemId !== parsed.itemId)) {
        throw new PriceServiceError(
            "PRICE_INVALID_CURSOR",
            "価格比較のcursorが不正です",
        );
    }
    const page = await listPriceRecordsByUnitPrice(env.DB, {
        itemId: parsed.itemId,
        limit: parsed.limit,
        cursor,
    });
    const items = page.rows.map((row: PriceComparisonRecordRow) =>
        toDto(env, row, row.unitPrice),
    );
    const last = items.at(-1);
    return {
        items,
        nextCursor:
            page.hasMore && last
                ? encodePriceComparisonCursor({
                      itemId: parsed.itemId,
                      unitPrice: last.unitPrice,
                      id: last.id,
                  })
                : null,
    };
};

/**
 * 複数品目の価格履歴をまとめて読む。cursor は品目ごとに紐付くため一括では扱わず、
 * 品目ごとに `limitPerItem` で切って `truncated` を返す（続きは 1 品目ずつの経路）。
 * 品目ごとのクエリは並列に投げるが、件数の上限は入力 schema 側で抑える。
 */
const listPriceBatch = async (
    db: D1Database,
    input: unknown,
    read: (args: {
        itemId: string;
        limit: number;
    }) => Promise<{ items: PriceRecordDto[]; hasMore: boolean }>,
): Promise<PriceBatchOutput> => {
    const parsed = priceBatchInputSchema.safeParse(input);
    if (!parsed.success) {
        throw invalidInput("価格履歴の入力値を確認してください");
    }
    const itemIds = [...new Set(parsed.data.itemIds)];
    const contexts = await Promise.all(
        itemIds.map((itemId) => findItemPricingContext(db, itemId)),
    );
    const known = itemIds.filter((_, index) => contexts[index] !== null);
    const notFound = itemIds.filter((_, index) => contexts[index] === null);
    const pages = await Promise.all(
        known.map((itemId) =>
            read({ itemId, limit: parsed.data.limitPerItem }),
        ),
    );
    return {
        results: known.map((itemId, index) => ({
            itemId,
            items: pages[index]?.items ?? [],
            truncated: pages[index]?.hasMore ?? false,
        })),
        notFound,
    };
};

export const listPriceRecordsForItems = async (
    env: PriceEnv,
    input: unknown,
): Promise<PriceBatchOutput> =>
    await listPriceBatch(env.DB, input, async ({ itemId, limit }) => {
        const page = await listPriceRecordRows(env.DB, {
            itemId,
            limit,
            cursor: null,
        });
        return {
            items: page.rows.map((row) => toDto(env, row)),
            hasMore: page.hasMore,
        };
    });

export const compareUnitPricesForItems = async (
    env: PriceEnv,
    input: unknown,
): Promise<PriceBatchOutput> =>
    await listPriceBatch(env.DB, input, async ({ itemId, limit }) => {
        const page = await listPriceRecordsByUnitPrice(env.DB, {
            itemId,
            limit,
            cursor: null,
        });
        return {
            items: page.rows.map((row: PriceComparisonRecordRow) =>
                toDto(env, row, row.unitPrice),
            ),
            hasMore: page.hasMore,
        };
    });

export type { PriceRecordCreateInput, PriceRecordListInput };
