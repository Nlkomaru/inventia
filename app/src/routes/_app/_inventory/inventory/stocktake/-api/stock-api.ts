import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ItemDto } from "@/domain/item";
import type { ItemLotDto } from "@/domain/lot";
import {
    type StockOperationResult,
    stockOperationResultSchema,
    stocktakeSchema,
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

/** 棚卸しの初期値は数量 > 0 のロットから作るため、既定の一覧を FEFO 順で取得する。 */
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

export interface StocktakeRequestInput {
    // 棚卸し後の全数状態。ここに現れない既存ロットは 0 になる
    lots: { expiryDate: string | null; quantity: number }[];
    idempotencyKey: string;
}

export const recordStocktake = (
    itemId: string,
    input: StocktakeRequestInput,
): Promise<StockOperationResult> => {
    const body = stocktakeSchema.parse({
        lots: input.lots,
        idempotencyKey: input.idempotencyKey,
    });
    return request(
        `/api/items/${encodeURIComponent(itemId)}/stocktake`,
        stockOperationResultSchema,
        "棚卸しを記録できませんでした",
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        },
    );
};
