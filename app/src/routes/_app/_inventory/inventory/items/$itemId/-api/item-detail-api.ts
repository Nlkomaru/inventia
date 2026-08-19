import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CategoryDto } from "@/domain/category";
import type { ItemDetailDto } from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import type { StockHistoryResult } from "@/domain/stock";

// 読み取りは server function から service を直接呼ぶ。SSR から自分の公開 URL を
// fetch すると Cloudflare Access に阻まれるため、HTTP API 経由にしない。
// `cloudflare:workers` と service はクライアントバンドルへ漏らさないよう動的 import する。

const itemIdInputSchema = z.object({
    itemId: z.string().trim().min(1),
});

const nodeIdInputSchema = z.object({
    id: z.string().trim().min(1),
});

/**
 * 品目の詳細。数量 > 0 のロット内訳と読書状態を同梱して返る。
 * service のエラー文言は API 利用者向けの英語なので、画面に出す分だけ
 * 利用者が次に何をすればよいか分かる日本語へ言い換える。
 */
export const fetchItemDetail = createServerFn({ method: "GET" })
    .validator(itemIdInputSchema)
    .handler(async ({ data }): Promise<ItemDetailDto> => {
        const [{ env }, { getItem, ItemServiceError }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/itemService"),
        ]);
        try {
            return await getItem(env.DB, data.itemId);
        } catch (error) {
            if (error instanceof ItemServiceError && error.status === 404) {
                throw new Error(
                    "品目が見つかりません。削除された可能性があります。在庫一覧から選び直してください。",
                );
            }
            throw error;
        }
    });

// カテゴリと保管場所は名前の表示だけに使うため、一覧ではなく 1 件ずつ引く
export const fetchCategory = createServerFn({ method: "GET" })
    .validator(nodeIdInputSchema)
    .handler(async ({ data }): Promise<CategoryDto> => {
        const [{ env }, { getCategory }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/categoryService"),
        ]);
        return getCategory(env.DB, data.id);
    });

export const fetchLocation = createServerFn({ method: "GET" })
    .validator(nodeIdInputSchema)
    .handler(async ({ data }): Promise<LocationDto> => {
        const [{ env }, { getLocation }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/locationService"),
        ]);
        return getLocation(env.DB, data.id);
    });

/**
 * この品目の履歴。未指定の cursor は「キーごと省略」で表す
 * （service 側の schema は strict なため null を渡さない）。
 */
const itemStockHistoryInputSchema = z.object({
    itemId: z.string().trim().min(1),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100),
});

export const listItemStockHistory = createServerFn({ method: "GET" })
    .validator(itemStockHistoryInputSchema)
    .handler(async ({ data }): Promise<StockHistoryResult> => {
        const [{ env }, { listStockHistory }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/stockService"),
        ]);
        return listStockHistory(env.DB, data);
    });
