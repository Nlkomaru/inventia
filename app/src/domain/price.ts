import { z } from "zod";
import { storeIdSchema } from "./store";

export const priceRecordDimensions = ["mass", "volume", "count"] as const;
export const priceRecordDimensionSchema = z.enum(priceRecordDimensions);

/**
 * The deliberately small set of units accepted at the price boundary.
 * Mass and volume are normalized through their smallest supported unit;
 * count units are discrete and therefore cannot be converted between names.
 */
export const priceContentUnits = [
    "g",
    "kg",
    "mL",
    "L",
    "個",
    "本",
    "ロール",
    "枚",
    "冊",
    "件",
] as const;
export const priceContentUnitSchema = z.enum(priceContentUnits);

const priceRecordIdSchema = z.string().trim().min(1).max(128);
const positiveIntegerSchema = z.int().min(1);
const nonNegativeIntegerSchema = z.int().min(0);

/** Price timestamps are persisted in the canonical UTC representation. */
export const utcDateTimeSchema = z.iso.datetime();

export const priceRecordCreateInputSchema = z
    .object({
        itemId: priceRecordIdSchema,
        // contentAmount is normalized to the item's baseUnit before persistence.
        contentAmount: positiveIntegerSchema,
        contentUnit: priceContentUnitSchema,
        setCount: positiveIntegerSchema.default(1),
        packaging: z.string().trim().max(200).nullable().optional(),
        price: nonNegativeIntegerSchema,
        // 店舗マスタを指す場合は省略でき、service が店名を source へ転記する。
        // 「source と storeId の少なくとも一方が必要」は service 層で検証する
        // （ここで .refine() を足すと prices.ts の .omit() が壊れる）
        source: z.string().trim().min(1).max(200).optional(),
        storeId: storeIdSchema.nullable().optional(),
        url: z.url().max(2048).nullable().optional(),
        recordedAt: utcDateTimeSchema,
    })
    .strict();

export const priceRecordCursorSchema = z
    .object({
        itemId: priceRecordIdSchema,
        recordedAt: utcDateTimeSchema,
        id: priceRecordIdSchema,
    })
    .strict();

/** Cursor scope and stable sort key for ascending unit-price comparison. */
export const priceComparisonCursorSchema = z
    .object({
        itemId: priceRecordIdSchema,
        unitPrice: z.number().finite().min(0),
        id: priceRecordIdSchema,
    })
    .strict();

export const priceRecordListInputSchema = z
    .object({
        itemId: priceRecordIdSchema,
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().trim().min(1).max(512).optional(),
    })
    .strict();

export const priceComparisonListInputSchema = z
    .object({
        itemId: priceRecordIdSchema,
        limit: z.coerce.number().int().min(1).max(100).default(100),
        cursor: z.string().trim().min(1).max(512).optional(),
    })
    .strict();

export const priceRecordDtoSchema = z
    .object({
        id: priceRecordIdSchema,
        itemId: priceRecordIdSchema,
        contentAmount: positiveIntegerSchema,
        setCount: positiveIntegerSchema,
        packaging: z.string().nullable(),
        price: nonNegativeIntegerSchema,
        source: z.string().min(1),
        storeId: priceRecordIdSchema.nullable(),
        storeName: z.string().nullable(),
        // ファビコンを持つ店舗の行だけ /api/stores/{id}/favicon を返す
        storeFaviconUrl: z.string().nullable(),
        url: z.url().nullable(),
        recordedAt: utcDateTimeSchema,
        createdAt: utcDateTimeSchema,
        baseUnit: z.string().min(1),
        baseDimension: priceRecordDimensionSchema,
        // This value is derived at read time and is never persisted.
        unitPrice: z.number().finite().min(0),
    })
    .strict();

export const priceRecordListOutputSchema = z
    .object({
        items: z.array(priceRecordDtoSchema),
        nextCursor: z.string().nullable(),
    })
    .strict();

// 複数品目の一括読み取り。cursor は品目ごとに紐付くため一括では扱わず、
// 品目ごとに打ち切りの有無だけを返す。続きは 1 品目ずつの tool で辿る
export const priceBatchItemIdsMax = 20;
export const priceBatchLimitPerItemMax = 20;

export const priceBatchInputSchema = z
    .object({
        itemIds: z.array(priceRecordIdSchema).min(1).max(priceBatchItemIdsMax),
        limitPerItem: z.coerce
            .number()
            .int()
            .min(1)
            .max(priceBatchLimitPerItemMax)
            .default(5),
    })
    .strict();

export const priceBatchResultSchema = z
    .object({
        itemId: z.string().min(1),
        items: z.array(priceRecordDtoSchema),
        // limitPerItem で切れたかどうか。続きは 1 品目ずつの tool で辿る
        truncated: z.boolean(),
    })
    .strict();

export const priceBatchOutputSchema = z
    .object({
        results: z.array(priceBatchResultSchema),
        // 価格履歴を引けなかった品目 id。1 件の欠落で全体を失わせない
        notFound: z.array(z.string()),
    })
    .strict();

export type PriceBatchInput = z.infer<typeof priceBatchInputSchema>;
export type PriceBatchOutput = z.infer<typeof priceBatchOutputSchema>;

export type PriceRecordDimension = z.infer<typeof priceRecordDimensionSchema>;
export type PriceContentUnit = z.infer<typeof priceContentUnitSchema>;
export type PriceRecordCreateInput = z.infer<
    typeof priceRecordCreateInputSchema
>;
export type NormalizedPriceRecordCreateInput = Omit<
    PriceRecordCreateInput,
    "contentUnit"
>;
export type PriceRecordCursor = z.infer<typeof priceRecordCursorSchema>;
export type PriceComparisonCursor = z.infer<typeof priceComparisonCursorSchema>;
export type PriceRecordListInput = z.infer<typeof priceRecordListInputSchema>;
export type PriceComparisonListInput = z.infer<
    typeof priceComparisonListInputSchema
>;
export type PriceRecordDto = z.infer<typeof priceRecordDtoSchema>;

export type PriceUnitDefinition = {
    dimension: PriceRecordDimension;
    factorToSmallest: number;
};

export const priceUnitDefinitions = {
    g: { dimension: "mass", factorToSmallest: 1 },
    kg: { dimension: "mass", factorToSmallest: 1_000 },
    mL: { dimension: "volume", factorToSmallest: 1 },
    L: { dimension: "volume", factorToSmallest: 1_000 },
    個: { dimension: "count", factorToSmallest: 1 },
    本: { dimension: "count", factorToSmallest: 1 },
    ロール: { dimension: "count", factorToSmallest: 1 },
    枚: { dimension: "count", factorToSmallest: 1 },
    冊: { dimension: "count", factorToSmallest: 1 },
    件: { dimension: "count", factorToSmallest: 1 },
} as const satisfies Record<PriceContentUnit, PriceUnitDefinition>;

export const getPriceUnitDefinition = (
    unit: string,
): PriceUnitDefinition | null => {
    const parsed = priceContentUnitSchema.safeParse(unit);
    return parsed.success ? priceUnitDefinitions[parsed.data] : null;
};

/**
 * Converts a submitted amount to the item's base unit. A null result means
 * that either unit is unknown/incompatible or the conversion is fractional.
 */
export const normalizeContentAmount = (
    contentAmount: number,
    contentUnit: string,
    baseUnit: string,
    baseDimension: PriceRecordDimension,
): number | null => {
    if (!Number.isSafeInteger(contentAmount) || contentAmount <= 0) {
        return null;
    }
    // 個数は換算しないため、同じ単位どうしなら恒等変換になる。単位表に無い
    // 基準単位（袋、パック、箱など）の品目でも価格を記録できるようにする
    if (baseDimension === "count") {
        return contentUnit === baseUnit ? contentAmount : null;
    }
    const source = getPriceUnitDefinition(contentUnit);
    const target = getPriceUnitDefinition(baseUnit);
    if (
        !source ||
        !target ||
        source.dimension !== baseDimension ||
        target.dimension !== baseDimension
    ) {
        return null;
    }
    const amountInSmallestUnit = contentAmount * source.factorToSmallest;
    if (!Number.isSafeInteger(amountInSmallestUnit)) {
        return null;
    }
    if (amountInSmallestUnit % target.factorToSmallest !== 0) {
        return null;
    }
    const normalized = amountInSmallestUnit / target.factorToSmallest;
    return Number.isSafeInteger(normalized) && normalized > 0
        ? normalized
        : null;
};

const toSmallestUnitAmount = (
    contentAmount: number,
    baseUnit: string,
    baseDimension: PriceRecordDimension,
): number | null => {
    // 個数は基準単位そのものが最小単位なので、単位表に無い単位でも 1 倍で扱う
    if (baseDimension === "count") {
        return Number.isSafeInteger(contentAmount) && contentAmount > 0
            ? contentAmount
            : null;
    }
    const base = getPriceUnitDefinition(baseUnit);
    if (!base || base.dimension !== baseDimension) {
        return null;
    }
    const amount = contentAmount * base.factorToSmallest;
    return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
};

/** The comparison basis required by the specification for each dimension. */
export const priceComparisonBasis = (
    dimension: PriceRecordDimension,
): 100 | 1 => (dimension === "count" ? 1 : 100);

/**
 * 単価は最小単位（質量は g、体積は mL）を基準に計算するため、表示する単位も
 * 品目の基準単位ではなく次元から導く。個数は基準単位がそのまま最小単位になる。
 */
export const priceComparisonUnit = (
    dimension: PriceRecordDimension,
    baseUnit: string,
): string => {
    if (dimension === "mass") {
        return "g";
    }
    if (dimension === "volume") {
        return "mL";
    }
    return baseUnit;
};

/**
 * Computes a price for one comparison unit. The result is intentionally not
 * stored; it is derived from the persisted price and package contents.
 */
export const calculateUnitPrice = (
    price: number,
    contentAmount: number,
    setCount: number,
    dimension: PriceRecordDimension,
    baseUnit?: string,
): number => {
    const contentInSmallestUnit = baseUnit
        ? toSmallestUnitAmount(contentAmount, baseUnit, dimension)
        : contentAmount;
    if (contentInSmallestUnit === null) {
        throw new RangeError("content amount cannot be normalized");
    }
    const totalContentAmount = contentInSmallestUnit * setCount;
    if (!Number.isSafeInteger(totalContentAmount) || totalContentAmount <= 0) {
        throw new RangeError("total content amount is out of range");
    }
    return (price / totalContentAmount) * priceComparisonBasis(dimension);
};

const toBase64Url = (value: string): string =>
    btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

const fromBase64Url = (value: string): string => {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
};

/** Encodes the stable descending history key into an opaque cursor. */
export const encodePriceRecordCursor = (cursor: PriceRecordCursor): string =>
    toBase64Url(
        encodeURIComponent(
            JSON.stringify(priceRecordCursorSchema.parse(cursor)),
        ),
    );

/** Returns null rather than leaking malformed cursor errors to transport code. */
export const decodePriceRecordCursor = (
    cursor: string,
): PriceRecordCursor | null => {
    try {
        const decoded = decodeURIComponent(fromBase64Url(cursor));
        const parsed: unknown = JSON.parse(decoded);
        const result = priceRecordCursorSchema.safeParse(parsed);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};

export const encodePriceComparisonCursor = (
    cursor: PriceComparisonCursor,
): string =>
    toBase64Url(
        encodeURIComponent(
            JSON.stringify(priceComparisonCursorSchema.parse(cursor)),
        ),
    );

export const decodePriceComparisonCursor = (
    cursor: string,
): PriceComparisonCursor | null => {
    try {
        const decoded = decodeURIComponent(fromBase64Url(cursor));
        const parsed: unknown = JSON.parse(decoded);
        const result = priceComparisonCursorSchema.safeParse(parsed);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};

export const canonicalUtcDateTime = (value: string): string =>
    new Date(utcDateTimeSchema.parse(value)).toISOString();
