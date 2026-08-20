import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CategoryDto } from "@/domain/category";
import type { ItemDto } from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import type { ItemLotDto } from "@/domain/lot";
import { readingStatusSchema } from "@/domain/reading";

// 一覧 service の 1 ページ上限。画面は全件を扱うため cursor を辿って集める
const pageLimit = 100;

export const inventoryItemFiltersSchema = z.object({
    q: z.string().optional(),
    categoryId: z.string().optional(),
    locationId: z.string().optional(),
    lowStockOnly: z.boolean().optional(),
    // 数量 > 0 のロットの期限が now + n 日以内の品目だけに絞る。0 は期限切れのみ
    expiringWithinDays: z.number().int().min(0).optional(),
    readingStatus: readingStatusSchema.optional(),
});

export type InventoryItemFilters = z.infer<typeof inventoryItemFiltersSchema>;

type Page<T> = { items: T[]; nextCursor: string | null };

// カテゴリと保管場所の一覧 service は 1 階層ずつ返すため、親を辿って全件を集める
const collectTree = async <T extends { id: string }>(
    listLevel: (
        parentId: string | null,
        cursor: string | undefined,
    ) => Promise<Page<T>>,
): Promise<T[]> => {
    const collected: T[] = [];
    const visit = async (parentId: string | null): Promise<void> => {
        const level: T[] = [];
        let cursor: string | undefined;
        do {
            const page = await listLevel(parentId, cursor);
            level.push(...page.items);
            cursor = page.nextCursor ?? undefined;
        } while (cursor);
        collected.push(...level);
        for (const node of level) await visit(node.id);
    };
    await visit(null);
    return collected;
};

export const fetchInventoryItems = createServerFn({ method: "GET" })
    .validator(inventoryItemFiltersSchema)
    .handler(async ({ data }): Promise<ItemDto[]> => {
        const [{ env }, { listItems }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/itemService"),
        ]);
        const items: ItemDto[] = [];
        let cursor: string | undefined;
        do {
            const page = await listItems(env.DB, {
                ...data,
                limit: pageLimit,
                cursor,
            });
            items.push(...page.items);
            cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return items;
    });

export const fetchCategoryTree = createServerFn({ method: "GET" }).handler(
    async (): Promise<CategoryDto[]> => {
        const [{ env }, { listCategories }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/categoryService"),
        ]);
        return collectTree<CategoryDto>((parentId, cursor) =>
            listCategories(env.DB, { parentId, limit: pageLimit, cursor }),
        );
    },
);

export const fetchLocationTree = createServerFn({ method: "GET" }).handler(
    async (): Promise<LocationDto[]> => {
        const [{ env }, { listLocations }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/locationService"),
        ]);
        return collectTree<LocationDto>((parentId, cursor) =>
            listLocations(env.DB, { parentId, limit: pageLimit, cursor }),
        );
    },
);

export type ItemLotsEntry = { itemId: string; lots: ItemLotDto[] };

// ロットは品目ごとの取得しか service に無いため、1 リクエストあたりの D1 query を
// 抑える目的で少しずつ並列に読む
const lotFetchConcurrency = 5;

export const fetchItemLots = createServerFn({ method: "GET" })
    .validator(z.object({ itemIds: z.array(z.string().min(1)) }))
    .handler(async ({ data }): Promise<ItemLotsEntry[]> => {
        const [{ env }, { listItemLots }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/lotService"),
        ]);
        const entries: ItemLotsEntry[] = [];
        for (
            let index = 0;
            index < data.itemIds.length;
            index += lotFetchConcurrency
        ) {
            const chunk = data.itemIds.slice(
                index,
                index + lotFetchConcurrency,
            );
            const settled = await Promise.allSettled(
                chunk.map(async (itemId) => ({
                    itemId,
                    lots: (await listItemLots(env.DB, itemId, {})).lots,
                })),
            );
            // 取得できなかった品目は返さず、件数のみの表示へ退避させる
            for (const result of settled) {
                if (result.status === "fulfilled") entries.push(result.value);
            }
        }
        return entries;
    });

// GET の server function は入力を URL へ載せるため、品目 id をまとめて渡しすぎない
const lotRequestChunkSize = 50;

export const listLotsForItems = async (
    itemIds: readonly string[],
): Promise<ItemLotsEntry[]> => {
    const chunks: string[][] = [];
    for (let index = 0; index < itemIds.length; index += lotRequestChunkSize) {
        chunks.push(itemIds.slice(index, index + lotRequestChunkSize));
    }
    const results = await Promise.all(
        chunks.map((chunk) => fetchItemLots({ data: { itemIds: chunk } })),
    );
    return results.flat();
};
