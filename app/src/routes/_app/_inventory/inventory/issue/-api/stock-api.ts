import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ItemDto } from "@/domain/item";
import type { ItemLotDto } from "@/domain/lot";
import {
    type StockMovementReason,
    type StockOperationResult,
    stockAdjustmentSchema,
} from "@/domain/stock";

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

/** 出庫候補は数量 > 0 のロットだけなので、既定の一覧（数量 0 を除く）を FEFO 順で取得する。 */
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

export interface IssueStockInput {
    quantity: number;
    // 未指定なら API が FEFO で自動配分する
    lotId: string | null;
    reason: StockMovementReason;
    // 用途の自由記述。未入力は記録しない
    note: string | null;
    // 在庫の行き先になった外部アプリ。未選択は記録しない
    externalProviderId: string | null;
    // 連携先アプリ側の ID。連携先が無ければ持てない
    externalId: string | null;
    idempotencyKey: string;
}

// 更新も読み取りと同じ server function 境界から service を直接呼ぶ。
// 画面は API トークンを持たず、/api の HTTP 経路を通らない。
const issueStockServerFn = createServerFn({ method: "POST" })
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
            throw new Error("出庫を記録できませんでした");
        }
    });

export const issueStock = (
    itemId: string,
    input: IssueStockInput,
): Promise<StockOperationResult> =>
    issueStockServerFn({
        data: {
            itemId,
            // schema は strict で空文字を受け付けないため、未入力の項目はキーごと省く
            input: stockAdjustmentSchema.parse({
                delta: -input.quantity,
                reason: input.reason,
                ...(input.lotId === null ? {} : { lotId: input.lotId }),
                ...(input.note === null ? {} : { note: input.note }),
                ...(input.externalProviderId === null
                    ? {}
                    : { externalProviderId: input.externalProviderId }),
                ...(input.externalId === null
                    ? {}
                    : { externalId: input.externalId }),
                idempotencyKey: input.idempotencyKey,
            }),
        },
    });
