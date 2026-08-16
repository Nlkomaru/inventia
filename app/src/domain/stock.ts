import { z } from "zod";

export const stockMovementReasons = [
    "purchase",
    "stocktake",
    "consume",
    "discard",
    "other",
] as const;

export const stockMovementReasonSchema = z.enum(stockMovementReasons);
export type StockMovementReason = z.infer<typeof stockMovementReasonSchema>;

export const stockOperationKinds = ["adjustment", "stocktake"] as const;
export const stockOperationKindSchema = z.enum(stockOperationKinds);
export type StockOperationKind = z.infer<typeof stockOperationKindSchema>;

export const stockOccurredAtSchema = z.iso
    .datetime({ offset: true })
    .refine(
        (value) => value.endsWith("Z") || value.endsWith("+00:00"),
        "must be a UTC date-time",
    );

const idempotencyKeySchema = z.string().trim().min(1).max(200);

export const stockAdjustmentSchema = z
    .object({
        delta: z.int().refine((value) => value !== 0, "delta must not be zero"),
        reason: stockMovementReasonSchema,
        occurredAt: stockOccurredAtSchema.optional(),
        idempotencyKey: idempotencyKeySchema,
    })
    .strict();

export const stocktakeSchema = z
    .object({
        quantity: z.int().min(0),
        occurredAt: stockOccurredAtSchema.optional(),
        idempotencyKey: idempotencyKeySchema,
    })
    .strict();

export const stockMovementDtoSchema = z
    .object({
        id: z.string().min(1),
        itemId: z.string().min(1),
        delta: z.int(),
        reason: stockMovementReasonSchema,
        occurredAt: stockOccurredAtSchema,
        idempotencyKey: z.string().min(1).nullable(),
        createdAt: stockOccurredAtSchema,
    })
    .strict();

export const stockOperationResultSchema = z
    .object({
        itemId: z.string().min(1),
        currentQuantity: z.int().min(0),
        movement: stockMovementDtoSchema.nullable(),
        replayed: z.boolean(),
    })
    .strict();

export const stockHistoryQuerySchema = z
    .object({
        itemId: z.string().trim().min(1).optional(),
        reason: stockMovementReasonSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).optional(),
    })
    .strict();

export const stockHistoryResultSchema = z
    .object({
        movements: z.array(stockMovementDtoSchema),
        nextCursor: z.string().nullable(),
    })
    .strict();

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type StocktakeInput = z.infer<typeof stocktakeSchema>;
export type StockMovementDto = z.infer<typeof stockMovementDtoSchema>;
export type StockOperationResult = z.infer<typeof stockOperationResultSchema>;
export type StockHistoryQuery = z.infer<typeof stockHistoryQuerySchema>;
export type StockHistoryResult = z.infer<typeof stockHistoryResultSchema>;
