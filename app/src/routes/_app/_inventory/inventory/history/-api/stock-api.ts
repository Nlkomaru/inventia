import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ItemDto } from "@/domain/item";
import {
    type StockHistoryResult,
    stockMovementReasonSchema,
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

/**
 * 履歴取得の入力。未指定の絞り込みと cursor は「キーごと省略」で表す。
 * service 側の schema は strict なため、null を渡さない。
 */
const stockHistoryInputSchema = z.object({
    itemId: z.string().trim().min(1).optional(),
    reason: stockMovementReasonSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100),
});

export type StockHistoryInput = z.infer<typeof stockHistoryInputSchema>;

/** 履歴は cursor ページングで、1 ページごとにロット内訳を同梱して返る。 */
export const listStockHistory = createServerFn({ method: "GET" })
    .validator(stockHistoryInputSchema)
    .handler(async ({ data }): Promise<StockHistoryResult> => {
        const [{ env }, { listStockHistory: listHistoryPage }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/stockService"),
            ]);
        return listHistoryPage(env.DB, data);
    });
