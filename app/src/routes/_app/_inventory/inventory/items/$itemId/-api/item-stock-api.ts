import { z } from "zod";
import { type ItemLotListDto, itemLotListDtoSchema } from "@/domain/lot";
import { type PriceRecordDto, priceRecordDtoSchema } from "@/domain/price";
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
    request(
        `/api/items/${encodeURIComponent(itemId)}/lots/${encodeURIComponent(lotId)}`,
        itemLotListDtoSchema,
        "期限を変更できませんでした",
        {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ expiryDate }),
        },
    );

export interface CreatePriceRecordInput {
    contentAmount: number;
    contentUnit: string;
    setCount: number;
    price: number;
    packaging: string | null;
    storeId: string | null;
    source?: string;
    recordedAt: string;
}

/** この品目の価格を 1 件記録する。単価は読み出し時に計算されるため保存しない。 */
export const createPriceRecord = (
    itemId: string,
    input: CreatePriceRecordInput,
): Promise<PriceRecordDto> =>
    request(
        `/api/items/${encodeURIComponent(itemId)}/prices`,
        priceRecordDtoSchema,
        "価格を記録できませんでした",
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
        },
    );
