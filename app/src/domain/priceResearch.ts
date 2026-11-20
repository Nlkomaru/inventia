import { z } from "zod";
import { itemBaseDimensionSchema, itemCreateSchema } from "./item";
import {
    priceContentUnitSchema,
    priceRecordDimensionSchema,
    utcDateTimeSchema,
} from "./price";
import { storeIdSchema } from "./store";

export const priceResearchStatuses = [
    "pending",
    "completed",
    "cancelled",
] as const;

export const priceResearchStatusSchema = z.enum(priceResearchStatuses);
export const priceResearchRequestIdSchema = z.string().trim().min(1).max(128);

export const priceResearchItemSummarySchema = z
    .object({
        id: z.string().min(1),
        name: z.string().min(1),
        baseUnit: z.string().min(1),
        baseDimension: itemBaseDimensionSchema,
    })
    .strict();

export const priceResearchPriceRecordSummarySchema = z
    .object({
        id: z.string().min(1),
        price: z.int().min(0),
        contentAmount: z.int().min(1),
        setCount: z.int().min(1),
        baseUnit: z.string().min(1),
        baseDimension: priceRecordDimensionSchema,
        unitPrice: z.number().finite().min(0),
        storeId: z.string().min(1).nullable(),
        storeName: z.string().nullable(),
        source: z.string().min(1),
        packaging: z.string().nullable(),
        url: z.url().nullable(),
        recordedAt: utcDateTimeSchema,
    })
    .strict();

export const priceResearchRequestDtoSchema = z
    .object({
        id: priceResearchRequestIdSchema,
        status: priceResearchStatusSchema,
        itemId: z.string().min(1).nullable(),
        requestedItemName: z.string().min(1),
        requestedUnit: z.string().nullable(),
        purpose: z.string().nullable(),
        note: z.string().nullable(),
        requestedBy: z.string().nullable(),
        priceRecordId: z.string().min(1).nullable(),
        completedAt: utcDateTimeSchema.nullable(),
        createdAt: utcDateTimeSchema,
        updatedAt: utcDateTimeSchema,
        item: priceResearchItemSummarySchema.nullable(),
        priceRecord: priceResearchPriceRecordSummarySchema.nullable(),
    })
    .strict();

export const priceResearchCreateSchema = z
    .object({
        itemId: z.string().trim().min(1).max(128).optional(),
        requestedItemName: z.string().trim().min(1).max(200).optional(),
        requestedUnit: z.string().trim().min(1).max(50).nullable().optional(),
        purpose: z.string().trim().min(1).max(500).nullable().optional(),
        note: z.string().trim().min(1).max(2000).nullable().optional(),
        requestedBy: z.string().trim().min(1).max(100).nullable().optional(),
    })
    .strict()
    .refine(
        (value) =>
            value.itemId !== undefined || value.requestedItemName !== undefined,
        {
            message:
                "requestedItemName is required when itemId is not provided",
            path: ["requestedItemName"],
        },
    );

export const priceResearchCompleteSchema = z
    .object({
        contentAmount: z.int().min(1),
        contentUnit: priceContentUnitSchema,
        setCount: z.int().min(1).default(1),
        price: z.int().min(0),
        storeId: storeIdSchema,
        packaging: z.string().trim().max(200).nullable().optional(),
        url: z.url().max(2048).nullable().optional(),
        recordedAt: utcDateTimeSchema.optional(),
        itemId: z.string().trim().min(1).max(128).optional(),
        newItem: itemCreateSchema.optional(),
    })
    .strict()
    .refine(
        (value) => !(value.itemId !== undefined && value.newItem !== undefined),
        {
            message: "Specify either itemId or newItem, not both",
            path: ["newItem"],
        },
    );

export const priceResearchListQuerySchema = z
    .object({
        status: priceResearchStatusSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().trim().min(1).max(512).optional(),
    })
    .strict();

export const priceResearchListOutputSchema = z
    .object({
        items: z.array(priceResearchRequestDtoSchema),
        nextCursor: z.string().nullable(),
    })
    .strict();

export const priceResearchCursorSchema = z
    .object({
        createdAt: utcDateTimeSchema,
        id: priceResearchRequestIdSchema,
    })
    .strict();

export type PriceResearchStatus = z.infer<typeof priceResearchStatusSchema>;
export type PriceResearchItemSummary = z.infer<
    typeof priceResearchItemSummarySchema
>;
export type PriceResearchPriceRecordSummary = z.infer<
    typeof priceResearchPriceRecordSummarySchema
>;
export type PriceResearchRequestDto = z.infer<
    typeof priceResearchRequestDtoSchema
>;
export type PriceResearchCreateInput = z.infer<
    typeof priceResearchCreateSchema
>;
export type PriceResearchCompleteInput = z.infer<
    typeof priceResearchCompleteSchema
>;
export type PriceResearchListQuery = z.infer<
    typeof priceResearchListQuerySchema
>;
export type PriceResearchListOutput = z.infer<
    typeof priceResearchListOutputSchema
>;
export type PriceResearchCursor = z.infer<typeof priceResearchCursorSchema>;

const toBase64Url = (value: string): string =>
    btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

const fromBase64Url = (value: string): string => {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
};

export const encodePriceResearchCursor = (
    cursor: PriceResearchCursor,
): string =>
    toBase64Url(
        encodeURIComponent(
            JSON.stringify(priceResearchCursorSchema.parse(cursor)),
        ),
    );

export const decodePriceResearchCursor = (
    cursor: string,
): PriceResearchCursor | null => {
    try {
        const decoded = decodeURIComponent(fromBase64Url(cursor));
        const parsed: unknown = JSON.parse(decoded);
        const result = priceResearchCursorSchema.safeParse(parsed);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};
