import {
    calculateUnitPrice,
    canonicalUtcDateTime,
    decodePriceComparisonCursor,
    decodePriceRecordCursor,
    encodePriceComparisonCursor,
    encodePriceRecordCursor,
    normalizeContentAmount,
    type PriceBatchOutput,
    type PriceComparisonListInput,
    type PriceRecordCreateInput,
    type PriceRecordDto,
    type PriceRecordListInput,
    priceBatchInputSchema,
    priceComparisonListInputSchema,
    priceRecordCreateInputSchema,
    priceRecordListInputSchema,
} from "../domain/price";
import {
    findItemPricingContext,
    insertPriceRecord,
    listPriceRecords as listPriceRecordRows,
    listPriceRecordsByUnitPrice,
    type PriceComparisonRecordRow,
    type PriceRecordRow,
} from "../repositories/priceRepository";

export type PriceServiceErrorCode =
    | "PRICE_INVALID_INPUT"
    | "PRICE_INVALID_CURSOR"
    | "PRICE_ITEM_NOT_FOUND";

const statusByCode: Record<PriceServiceErrorCode, 400 | 404> = {
    PRICE_INVALID_INPUT: 400,
    PRICE_INVALID_CURSOR: 400,
    PRICE_ITEM_NOT_FOUND: 404,
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

const parseListInput = (input: unknown): PriceRecordListInput => {
    const result = priceRecordListInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("itemId、limit、cursorを確認してください");
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
    url: row.url,
    recordedAt: canonicalUtcDateTime(row.recordedAt),
    createdAt: canonicalUtcDateTime(row.createdAt),
    baseUnit: row.baseUnit,
    baseDimension: row.baseDimension,
    unitPrice,
});

export type PriceRecordListResponse = {
    items: PriceRecordDto[];
    nextCursor: string | null;
};

export const createPriceRecord = async (
    db: D1Database,
    input: unknown,
): Promise<PriceRecordDto> => {
    const parsed = parseCreateInput(input);
    const item = await findItemPricingContext(db, parsed.itemId);
    if (!item) {
        throw new PriceServiceError(
            "PRICE_ITEM_NOT_FOUND",
            "指定された商品が見つかりません",
        );
    }
    const normalizedContentAmount = normalizeContentAmount(
        parsed.contentAmount,
        parsed.contentUnit,
        item.baseUnit,
        item.baseDimension,
    );
    if (normalizedContentAmount === null) {
        throw invalidInput(
            "内容量単位が商品の基準単位と互換性がないか、整数へ変換できません",
        );
    }
    const { contentUnit: _contentUnit, ...normalizedInput } = parsed;
    return toDto(
        await insertPriceRecord(db, {
            ...normalizedInput,
            contentAmount: normalizedContentAmount,
        }),
    );
};

export const listPriceRecords = async (
    db: D1Database,
    input: unknown,
): Promise<PriceRecordListResponse> => {
    const parsed = parseListInput(input);
    const item = await findItemPricingContext(db, parsed.itemId);
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
    const page = await listPriceRecordRows(db, {
        itemId: parsed.itemId,
        limit: parsed.limit,
        cursor,
    });
    // toDto の第 2 引数は単価で、既定は行から計算する。map へ関数をそのまま渡すと
    // 添字が単価として入るため、1 引数で呼ぶ
    const items = page.rows.map((row) => toDto(row));
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

export const compareUnitPrices = async (
    db: D1Database,
    input: unknown,
): Promise<PriceRecordListResponse> => {
    const parsed = parseComparisonInput(input);
    const item = await findItemPricingContext(db, parsed.itemId);
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
    const page = await listPriceRecordsByUnitPrice(db, {
        itemId: parsed.itemId,
        limit: parsed.limit,
        cursor,
    });
    const items = page.rows.map((row: PriceComparisonRecordRow) =>
        toDto(row, row.unitPrice),
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
    db: D1Database,
    input: unknown,
): Promise<PriceBatchOutput> =>
    await listPriceBatch(db, input, async ({ itemId, limit }) => {
        const page = await listPriceRecordRows(db, {
            itemId,
            limit,
            cursor: null,
        });
        return {
            items: page.rows.map((row) => toDto(row)),
            hasMore: page.hasMore,
        };
    });

export const compareUnitPricesForItems = async (
    db: D1Database,
    input: unknown,
): Promise<PriceBatchOutput> =>
    await listPriceBatch(db, input, async ({ itemId, limit }) => {
        const page = await listPriceRecordsByUnitPrice(db, {
            itemId,
            limit,
            cursor: null,
        });
        return {
            items: page.rows.map((row: PriceComparisonRecordRow) =>
                toDto(row, row.unitPrice),
            ),
            hasMore: page.hasMore,
        };
    });

export type { PriceRecordCreateInput, PriceRecordListInput };
