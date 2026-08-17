import { z } from "zod";
import {
    itemLotDtoSchema,
    type LotStocktakeEntry,
    lotAllocationDtoSchema,
    lotExpiryDateSchema,
} from "./lot";

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

const lotIdSchema = z.string().trim().min(1).max(128);

// 棚卸しは 1 リクエストのロット指定数を上限で抑える。ロット 1 件ごとに
// 書き込みバッチへ statement が増えるため、無制限の入力を受け付けない
const stocktakeLotsSchema = z
    .array(
        z
            .object({
                expiryDate: lotExpiryDateSchema,
                quantity: z.int().min(0),
            })
            .strict(),
    )
    .min(1)
    .max(100);

export const stockAdjustmentSchema = z
    .object({
        delta: z.int().refine((value) => value !== 0, "delta must not be zero"),
        reason: stockMovementReasonSchema,
        // 対象ロットの期限。delta > 0 では加算先（省略時は期限なしロット）、
        // delta < 0 では減算元。delta < 0 で省略した場合は FEFO で自動配分する
        expiryDate: lotExpiryDateSchema.optional(),
        // 対象ロットの直接指定。expiryDate との同時指定はできない
        lotId: lotIdSchema.optional(),
        occurredAt: stockOccurredAtSchema.optional(),
        idempotencyKey: idempotencyKeySchema,
    })
    .strict()
    .refine(
        (value) => value.lotId === undefined || value.expiryDate === undefined,
        {
            message: "lotId and expiryDate must not be provided together",
            path: ["lotId"],
        },
    );

export const stocktakeSchema = z
    .object({
        // 合計指定。数量 > 0 のロットが 2 件以上ある品目では按分の解釈が
        // 定まらないため拒否し、lots での指定を求める
        quantity: z.int().min(0).optional(),
        // 棚卸し後の全数状態。リストに現れない既存ロットは 0 になる
        lots: stocktakeLotsSchema.optional(),
        occurredAt: stockOccurredAtSchema.optional(),
        idempotencyKey: idempotencyKeySchema,
    })
    .strict()
    .refine(
        (value) =>
            (value.quantity === undefined) !== (value.lots === undefined),
        {
            message: "exactly one of quantity or lots is required",
            path: ["quantity"],
        },
    );

export const stockMovementDtoSchema = z
    .object({
        id: z.string().min(1),
        itemId: z.string().min(1),
        delta: z.int(),
        reason: stockMovementReasonSchema,
        occurredAt: stockOccurredAtSchema,
        idempotencyKey: z.string().min(1).nullable(),
        createdAt: stockOccurredAtSchema,
        // ロット別の内訳。ロット追跡を導入する前に記録された履歴は空配列になる
        allocations: z.array(lotAllocationDtoSchema),
    })
    .strict();

export const stockOperationResultSchema = z
    .object({
        itemId: z.string().min(1),
        // 操作後に読み取った在庫数量。`lots` と同じ読み取りから導くため、
        // 常に `currentQuantity == sum(lots.quantity)` が成立する
        currentQuantity: z.int().min(0),
        movement: stockMovementDtoSchema.nullable(),
        // この操作で増減したロットの内訳。再送時は記録済み movement の内訳を返す
        allocations: z.array(lotAllocationDtoSchema),
        // 操作後のロット状態（数量 0 のロットは含めない）
        lots: z.array(itemLotDtoSchema),
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

/** 在庫操作が対象とするロットの指定方法。`unspecified` の出庫は FEFO で配分する。 */
export type StockLotSelector =
    | { mode: "unspecified" }
    | { mode: "expiry"; expiryDate: string | null }
    | { mode: "lot"; lotId: string };

export interface StockRequestDigestInput {
    kind: StockOperationKind;
    itemId: string;
    reason: StockMovementReason;
    // 入力で省略された occurredAt は自動値のため digest に含めない
    occurredAt: string | null;
    delta: number | null;
    targetQuantity: number | null;
    selector: StockLotSelector;
    lots: readonly LotStocktakeEntry[] | null;
}

// 値の境界を入力に現れない制御文字で区切り、連結による衝突を避ける
const digestSeparator = "\u001f";

const selectorPart = (selector: StockLotSelector): string => {
    if (selector.mode === "lot") {
        return `lot:${selector.lotId}`;
    }
    if (selector.mode === "expiry") {
        return `expiry:${selector.expiryDate ?? "none"}`;
    }
    return "unspecified";
};

// ロット指定の並び順の違いだけで別リクエスト扱いにしないため、期限で整列してから連結する
const lotsPart = (lots: readonly LotStocktakeEntry[] | null): string =>
    lots === null
        ? ""
        : [...lots]
              .sort((left, right) => {
                  const leftKey = left.expiryDate ?? "";
                  const rightKey = right.expiryDate ?? "";
                  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
              })
              .map((lot) => `${lot.expiryDate ?? "none"}=${lot.quantity}`)
              .join(",");

const toHex = (buffer: ArrayBuffer): string =>
    Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

/**
 * 再送リクエストの同一性判定に使う正規化リクエストの SHA-256 hex。
 * ロット指定まで含めるため、同じ idempotency key で内訳の違うリクエストを検出できる。
 */
export const stockRequestDigest = async (
    input: StockRequestDigestInput,
): Promise<string> => {
    const canonical = [
        input.kind,
        input.itemId,
        input.reason,
        input.occurredAt ?? "auto",
        input.delta === null ? "" : String(input.delta),
        input.targetQuantity === null ? "" : String(input.targetQuantity),
        selectorPart(input.selector),
        lotsPart(input.lots),
    ].join(digestSeparator);
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical),
    );
    return toHex(digest);
};

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type StocktakeInput = z.infer<typeof stocktakeSchema>;
export type StockMovementDto = z.infer<typeof stockMovementDtoSchema>;
export type StockOperationResult = z.infer<typeof stockOperationResultSchema>;
export type StockHistoryQuery = z.infer<typeof stockHistoryQuerySchema>;
export type StockHistoryResult = z.infer<typeof stockHistoryResultSchema>;
