import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ItemDto } from "@/domain/item";
import type { ItemLotDto } from "@/domain/lot";
import { type StockOperationResult, stocktakeSchema } from "@/domain/stock";

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

// 更新も読み取りと同じ server function 境界から service を直接呼ぶ。
// 画面は API トークンを持たず、/api の HTTP 経路を通らない。
const recordStocktakeServerFn = createServerFn({ method: "POST" })
    .validator(
        z.object({
            // itemId の正規化と検証は service が持つ（INVALID_ID の文言も service 側）
            itemId: z.string(),
            input: stocktakeSchema,
        }),
    )
    .handler(async ({ data }): Promise<StockOperationResult> => {
        const [{ env }, { stocktake, StockServiceError }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/stockService"),
        ]);
        try {
            return await stocktake(env.DB, data.itemId, data.input);
        } catch (error) {
            if (error instanceof StockServiceError) {
                throw new Error(error.message);
            }
            throw new Error("棚卸しを記録できませんでした");
        }
    });

export const recordStocktake = (
    itemId: string,
    input: StocktakeRequestInput,
): Promise<StockOperationResult> =>
    recordStocktakeServerFn({
        data: {
            itemId,
            input: stocktakeSchema.parse({
                lots: input.lots,
                idempotencyKey: input.idempotencyKey,
            }),
        },
    });
