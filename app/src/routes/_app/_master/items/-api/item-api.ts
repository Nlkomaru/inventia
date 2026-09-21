import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CategoryDto } from "@/domain/category";
import {
    type ItemCreateInput,
    type ItemDetailDto,
    type ItemDto,
    type ItemUpdateInput,
    itemCreateSchema,
    itemListQuerySchema,
    itemUpdateSchema,
} from "@/domain/item";
import type { LocationDto } from "@/domain/location";

const itemMasterListInputSchema = itemListQuerySchema.pick({
    sort: true,
    sortDirection: true,
});

// Cloudflare Access が公開 URL に掛かるため、読み取りは server function から
// service を直接呼ぶ。cloudflare:workers と services はクライアントバンドルへ
// 漏らさないよう handler 内で動的 import する。
export const listAllItems = createServerFn({ method: "GET" })
    .validator(itemMasterListInputSchema)
    .handler(async ({ data }) => {
        const [{ env }, { listItems }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/itemService"),
        ]);
        const result: ItemDto[] = [];
        let cursor: string | undefined;
        do {
            const page = await listItems(env.DB, {
                ...data,
                limit: 100,
                cursor,
            });
            result.push(...page.items);
            cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return result;
    });

export const listCategoryTree = createServerFn({ method: "GET" }).handler(
    async () => {
        const [{ env }, { listCategories }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/categoryService"),
        ]);
        const result: CategoryDto[] = [];
        const listLevel = async (parentId: string | null) => {
            let cursor: string | undefined;
            do {
                const page = await listCategories(env.DB, {
                    parentId,
                    limit: 100,
                    cursor,
                });
                result.push(...page.items);
                cursor = page.nextCursor ?? undefined;
            } while (cursor);
        };
        const visit = async (parentId: string | null) => {
            const start = result.length;
            await listLevel(parentId);
            for (const child of result.slice(start)) await visit(child.id);
        };
        await visit(null);
        return result;
    },
);

export const listLocationTree = createServerFn({ method: "GET" }).handler(
    async () => {
        const [{ env }, { listLocations }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/locationService"),
        ]);
        const result: LocationDto[] = [];
        const listLevel = async (parentId: string | null) => {
            let cursor: string | undefined;
            do {
                const page = await listLocations(env.DB, {
                    parentId,
                    limit: 100,
                    cursor,
                });
                result.push(...page.items);
                cursor = page.nextCursor ?? undefined;
            } while (cursor);
        };
        const visit = async (parentId: string | null) => {
            const start = result.length;
            await listLevel(parentId);
            for (const child of result.slice(start)) await visit(child.id);
        };
        await visit(null);
        return result;
    },
);

export const getItemDetail = createServerFn({ method: "GET" })
    .validator(z.object({ itemId: z.string().min(1) }))
    .handler(async ({ data }): Promise<ItemDetailDto> => {
        const [{ env }, { getItem, ItemServiceError }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/itemService"),
        ]);
        try {
            return await getItem(env.DB, data.itemId);
        } catch (error) {
            // service の文言は API 利用者向けの英語なので、画面へ出す分だけ
            // 次に何をすればよいか分かる日本語へ言い換える
            if (error instanceof ItemServiceError && error.status === 404) {
                throw new Error(
                    "品目が見つかりません。削除された可能性があります。品目マスタから選び直してください。",
                );
            }
            throw error;
        }
    });

/**
 * 基準単位・次元のつけ替えで意味が変わる記録があるか。件数は使わないため、
 * それぞれ 1 件だけ引いて有無を判定する。
 */
export type ItemRelabelImpact = {
    hasStockMovements: boolean;
    hasPriceRecords: boolean;
};

export const getItemRelabelImpact = createServerFn({ method: "GET" })
    .validator(z.object({ itemId: z.string().min(1) }))
    .handler(async ({ data }): Promise<ItemRelabelImpact> => {
        const [{ env }, { listStockHistory }, { listPriceRecords }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/stockService"),
                import("@/services/priceService"),
            ]);
        const [history, prices] = await Promise.all([
            listStockHistory(env.DB, { itemId: data.itemId, limit: 1 }),
            listPriceRecords(env, { itemId: data.itemId, limit: 1 }),
        ]);
        return {
            hasStockMovements: history.movements.length > 0,
            hasPriceRecords: prices.items.length > 0,
        };
    });

const createItemServerFn = createServerFn({ method: "POST" })
    .validator(itemCreateSchema)
    .handler(async ({ data }): Promise<ItemDto> => {
        const [{ env }, { createItem, ItemServiceError }, { indexItem }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/itemService"),
                import("@/services/itemSearchService"),
            ]);
        try {
            const created = await createItem(env.DB, data);
            // 索引更新は best-effort（service 内で例外を握り潰す）。HTTP 経由と
            // 同じく、画面から作った品目も意味検索の対象へ入れておく
            await indexItem(env, created.id);
            return created;
        } catch (error) {
            if (error instanceof ItemServiceError) {
                throw new Error(error.message);
            }
            throw new Error("品目の更新に失敗しました");
        }
    });

const updateItemServerFn = createServerFn({ method: "POST" })
    .validator(
        z.object({
            itemId: z.string().min(1),
            input: itemUpdateSchema,
        }),
    )
    .handler(async ({ data }): Promise<ItemDto> => {
        const [{ env }, { updateItem, ItemServiceError }, { indexItem }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/itemService"),
                import("@/services/itemSearchService"),
            ]);
        try {
            const updated = await updateItem(env.DB, data.itemId, data.input);
            // 埋め込み対象は品目名だけなので、name を送っていない更新では索引を触らない
            if (data.input.name !== undefined) {
                await indexItem(env, updated.id);
            }
            return updated;
        } catch (error) {
            if (error instanceof ItemServiceError) {
                throw new Error(error.message);
            }
            throw new Error("品目の更新に失敗しました");
        }
    });

const deleteItemServerFn = createServerFn({ method: "POST" })
    .validator(z.object({ itemId: z.string().min(1) }))
    .handler(async ({ data }): Promise<{ deleted: true }> => {
        const [
            { env },
            { deleteItem, ItemServiceError },
            { removeItemFromIndex },
        ] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/itemService"),
            import("@/services/itemSearchService"),
        ]);
        try {
            await deleteItem(env.DB, data.itemId);
            // 索引更新は best-effort。消した品目を意味検索の結果に残さない
            await removeItemFromIndex(env, data.itemId);
            return { deleted: true };
        } catch (error) {
            if (error instanceof ItemServiceError) {
                throw new Error(error.message);
            }
            throw new Error("品目の更新に失敗しました");
        }
    });

// 呼び出し側の互換性のため、公開する関数は入力の並びを変えない薄いラッパーに留める
export const createItem = (input: ItemCreateInput): Promise<ItemDto> =>
    createItemServerFn({ data: input });

export const updateItem = (
    id: string,
    input: ItemUpdateInput,
): Promise<ItemDto> => updateItemServerFn({ data: { itemId: id, input } });

export const deleteItem = (id: string): Promise<{ deleted: true }> =>
    deleteItemServerFn({ data: { itemId: id } });
