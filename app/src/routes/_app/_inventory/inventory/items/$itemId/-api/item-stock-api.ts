import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { type ItemLotListDto, lotUpdateSchema } from "@/domain/lot";
import {
    type StockMovementDto,
    type StockMovementReason,
    type StockOperationResult,
    stockAdjustmentSchema,
    stockMovementNoteCorrectionSchema,
} from "@/domain/stock";

export interface ReceiveStockInput {
    quantity: number;
    // null は期限なしロットへの加算を意味する
    expiryDate: string | null;
    reason: StockMovementReason;
    idempotencyKey: string;
}

export interface IssueStockInput {
    quantity: number;
    reason: StockMovementReason;
    note?: string;
    idempotencyKey: string;
}

// 更新は読み取りと同じ server function 境界から service を直接呼ぶ。
// 画面は API トークンを持たず、/api の HTTP 経路を通らない。
// `cloudflare:workers` と service はクライアントバンドルへ漏らさないよう動的 import する。
const receiveStockServerFn = createServerFn({ method: "POST" })
    .validator(
        z.object({
            // itemId の正規化と検証は service が持つ（INVALID_ID の文言も service 側）
            itemId: z.string(),
            input: stockAdjustmentSchema,
        }),
    )
    .handler(async ({ data }): Promise<StockOperationResult> => {
        const [{ env }, { adjustStock, StockServiceError }] = await Promise.all(
            [import("cloudflare:workers"), import("@/services/stockService")],
        );
        try {
            return await adjustStock(env.DB, data.itemId, data.input);
        } catch (error) {
            if (error instanceof StockServiceError) {
                throw new Error(error.message);
            }
            throw new Error("入庫を記録できませんでした");
        }
    });

const issueStockServerFn = createServerFn({ method: "POST" })
    .validator(
        z.object({
            itemId: z.string(),
            input: stockAdjustmentSchema,
        }),
    )
    .handler(async ({ data }): Promise<StockOperationResult> => {
        const [{ env }, { adjustStock, StockServiceError }] = await Promise.all(
            [import("cloudflare:workers"), import("@/services/stockService")],
        );
        try {
            return await adjustStock(env.DB, data.itemId, data.input);
        } catch (error) {
            if (error instanceof StockServiceError) {
                throw new Error(error.message);
            }
            throw new Error("出庫を記録できませんでした");
        }
    });

const correctMovementNoteServerFn = createServerFn({ method: "POST" })
    .validator(
        z.object({
            // movementId の正規化と検証は service が持つ
            movementId: z.string(),
            input: stockMovementNoteCorrectionSchema,
        }),
    )
    .handler(async ({ data }): Promise<StockMovementDto> => {
        const [{ env }, { correctStockMovementNote, StockServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/stockService"),
            ]);
        try {
            return await correctStockMovementNote(
                env.DB,
                data.movementId,
                data.input,
            );
        } catch (error) {
            if (error instanceof StockServiceError) {
                throw new Error(error.message);
            }
            throw new Error("メモを訂正できませんでした");
        }
    });

const updateLotExpiryServerFn = createServerFn({ method: "POST" })
    .validator(
        z.object({
            // itemId と lotId の正規化と検証は service が持つ
            itemId: z.string(),
            lotId: z.string(),
            input: lotUpdateSchema,
        }),
    )
    .handler(async ({ data }): Promise<ItemLotListDto> => {
        const [{ env }, { updateLotExpiryDate, LotServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/lotService"),
            ]);
        try {
            return await updateLotExpiryDate(
                env.DB,
                data.itemId,
                data.lotId,
                data.input,
            );
        } catch (error) {
            if (error instanceof LotServiceError) {
                throw new Error(error.message);
            }
            throw new Error("期限を変更できませんでした");
        }
    });

/** この品目へ在庫を足す。入庫画面と同じ調整エンドポイントを使う。 */
export const receiveStock = (
    itemId: string,
    input: ReceiveStockInput,
): Promise<StockOperationResult> =>
    receiveStockServerFn({
        data: {
            itemId,
            input: stockAdjustmentSchema.parse({
                delta: input.quantity,
                reason: input.reason,
                expiryDate: input.expiryDate,
                idempotencyKey: input.idempotencyKey,
            }),
        },
    });

/** この品目から FEFO で出庫する。ロットを省略し、service の共通配分を使う。 */
export const issueStock = (
    itemId: string,
    input: IssueStockInput,
): Promise<StockOperationResult> =>
    issueStockServerFn({
        data: {
            itemId,
            input: stockAdjustmentSchema.parse({
                delta: -input.quantity,
                reason: input.reason,
                note: input.note,
                idempotencyKey: input.idempotencyKey,
            }),
        },
    });

/** 数量やロット配分を再適用せず、movement id でメモだけを訂正する。 */
export const correctMovementNote = (
    movementId: string,
    note: string | null,
): Promise<StockMovementDto> =>
    correctMovementNoteServerFn({
        data: {
            movementId,
            input: stockMovementNoteCorrectionSchema.parse({ note }),
        },
    });

/**
 * 既存ロットの期限だけを直す。数量は動かないため在庫履歴は増えない。
 * 応答は直したロット 1 件ではなく、訂正後の在庫ありロット全件（FEFO 順）。
 * 期限をまとめると 2 つのロットが 1 つになるため、1 件では表せない。
 */
export const updateLotExpiry = (
    itemId: string,
    lotId: string,
    expiryDate: string | null,
): Promise<ItemLotListDto> =>
    updateLotExpiryServerFn({ data: { itemId, lotId, input: { expiryDate } } });
