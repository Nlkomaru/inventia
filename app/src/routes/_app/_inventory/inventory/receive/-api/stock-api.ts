import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ItemDto } from "@/domain/item";
import type { ItemLotDto } from "@/domain/lot";
import {
    type StockMovementReason,
    type StockOperationResult,
    stockAdjustmentSchema,
    stockOperationResultSchema,
} from "@/domain/stock";

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

// 読み取りは server function から service を直接呼ぶ。SSR から自分の公開 URL を
// fetch すると Cloudflare Access に阻まれるため、HTTP API 経由にしない。
// `cloudflare:workers` と service はクライアントバンドルへ漏らさないよう動的 import する。
export const listItems = createServerFn({ method: "GET" }).handler(
    async (): Promise<ItemDto[]> => {
        const [{ env }, { listItems: listItemPage }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/itemService"),
        ]);
        const items: ItemDto[] = [];
        let cursor: string | undefined;
        do {
            const page = await listItemPage(env.DB, {
                limit: 100,
                ...(cursor === undefined ? {} : { cursor }),
            });
            items.push(...page.items);
            cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return items;
    },
);

const itemLotsInputSchema = z.object({
    itemId: z.string().trim().min(1),
});

/** 加算先の候補を示すため、数量 > 0 のロットを FEFO 順で取得する。 */
export const listItemLots = createServerFn({ method: "GET" })
    .validator(itemLotsInputSchema)
    .handler(async ({ data }): Promise<ItemLotDto[]> => {
        const [{ env }, { listItemLots: listLotsForItem }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/lotService"),
        ]);
        const result = await listLotsForItem(env.DB, data.itemId, {});
        return result.lots;
    });

export interface ReceiveStockInput {
    quantity: number;
    // null は期限なしロットへの加算を意味する
    expiryDate: string | null;
    reason: StockMovementReason;
    idempotencyKey: string;
}

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
