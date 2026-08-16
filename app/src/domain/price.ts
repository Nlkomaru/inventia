import { z } from "zod";

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
        source: z.string().trim().min(1).max(200),
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
    if (baseDimension === "count" && contentUnit !== baseUnit) {
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
