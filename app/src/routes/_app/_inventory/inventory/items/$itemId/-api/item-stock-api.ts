import { z } from "zod";
import {
    type StockMovementReason,
    type StockOperationResult,
    stockAdjustmentSchema,
    stockOperationResultSchema,
} from "@/domain/stock";

// 在庫の書き込みは HTTP API を通す。読み取りと違い、冪等キーや排他の扱いを
// API 層と共有したいため server function からは呼ばない。
const apiErrorSchema = z.object({
    error: z
        .object({
            message: z.string().optional(),
        })
        .optional(),
});

const request = async <T>(
    url: string,
    schema: z.ZodType<T>,
    fallbackMessage: string,
    init?: RequestInit,
): Promise<T> => {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = apiErrorSchema.safeParse(
            await response.json().catch(() => ({})),
        );
        throw new Error(
            body.success && body.data.error?.message
                ? body.data.error.message
                : fallbackMessage,
        );
    }
    return schema.parse(await response.json());
};

export interface ReceiveStockInput {
    quantity: number;
    // null は期限なしロットへの加算を意味する
    expiryDate: string | null;
    reason: StockMovementReason;
    idempotencyKey: string;
}

/** この品目へ在庫を足す。入庫画面と同じ調整エンドポイントを使う。 */
export const receiveStock = (
    itemId: string,
    input: ReceiveStockInput,
): Promise<StockOperationResult> => {
    const body = stockAdjustmentSchema.parse({
        delta: input.quantity,
        reason: input.reason,
        expiryDate: input.expiryDate,
        idempotencyKey: input.idempotencyKey,
    });
    return request(
        `/api/items/${encodeURIComponent(itemId)}/adjustments`,
        stockOperationResultSchema,
        "入庫を記録できませんでした",
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        },
    );
};
