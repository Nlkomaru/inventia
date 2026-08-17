import { z } from "zod";
import { type CategoryDto, categoryListOutputSchema } from "@/domain/category";
import { type ItemDto, itemDtoSchema } from "@/domain/item";
import { type LocationDto, locationListOutputSchema } from "@/domain/location";
import { type ItemLotDto, itemLotListDtoSchema } from "@/domain/lot";

const apiErrorSchema = z.object({
    error: z
        .object({
            message: z.string().optional(),
        })
        .optional(),
});

const itemListOutputSchema = z.object({
    items: z.array(itemDtoSchema),
    nextCursor: z.string().nullable(),
});

const request = async <T>(
    url: string,
    schema: z.ZodType<T>,
    fallbackMessage: string,
): Promise<T> => {
    const response = await fetch(url);
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

const hierarchyUrl = (
    path: string,
    parentId: string | null,
    cursor: string | undefined,
): string => {
    const params = new URLSearchParams({ limit: "100" });
    if (parentId) params.set("parentId", parentId);
    if (cursor) params.set("cursor", cursor);
    return `${path}?${params.toString()}`;
};

// カテゴリと保管場所の一覧 API は 1 階層ずつ返すため、親を辿って全件を集める
const collectHierarchy = async <T extends { id: string }>(
    fetchLevel: (
        parentId: string | null,
        cursor: string | undefined,
    ) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> => {
    const collected: T[] = [];
    const visit = async (parentId: string | null): Promise<void> => {
        const level: T[] = [];
        let cursor: string | undefined;
        do {
            const page = await fetchLevel(parentId, cursor);
            level.push(...page.items);
            cursor = page.nextCursor ?? undefined;
        } while (cursor);
        collected.push(...level);
        for (const node of level) await visit(node.id);
    };
    await visit(null);
    return collected;
};

export const listItems = async (): Promise<ItemDto[]> => {
    const items: ItemDto[] = [];
    let cursor: string | undefined;
    do {
        const params = new URLSearchParams({ limit: "100" });
        if (cursor) params.set("cursor", cursor);
        const page = await request(
            `/api/items?${params.toString()}`,
            itemListOutputSchema,
            "在庫を読み込めませんでした",
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
};

export const listCategories = (): Promise<CategoryDto[]> =>
    collectHierarchy((parentId, cursor) =>
        request(
            hierarchyUrl("/api/categories", parentId, cursor),
            categoryListOutputSchema,
            "カテゴリを読み込めませんでした",
        ),
    );

export const listLocations = (): Promise<LocationDto[]> =>
    collectHierarchy((parentId, cursor) =>
        request(
            hierarchyUrl("/api/locations", parentId, cursor),
            locationListOutputSchema,
            "保管場所を読み込めませんでした",
        ),
    );

export const listItemLots = async (itemId: string): Promise<ItemLotDto[]> => {
    const result = await request(
        `/api/items/${encodeURIComponent(itemId)}/lots`,
        itemLotListDtoSchema,
        "ロットを読み込めませんでした",
    );
    return result.lots;
};

// 一覧 DTO は最短期限と件数だけを持つため、内訳が必要な品目だけ個別に取得する。
// 1 ロットの品目は合計と最短期限で内訳が尽きているので取得しない
const lotFetchConcurrency = 5;

export const listLotsForItems = async (
    items: readonly ItemDto[],
): Promise<Map<string, ItemLotDto[]>> => {
    const targets = items.filter((item) => item.lotCount > 1);
    const lotsByItemId = new Map<string, ItemLotDto[]>();
    for (let index = 0; index < targets.length; index += lotFetchConcurrency) {
        const chunk = targets.slice(index, index + lotFetchConcurrency);
        const settled = await Promise.allSettled(
            chunk.map(async (item) => ({
                itemId: item.id,
                lots: await listItemLots(item.id),
            })),
        );
        // 取得できなかった品目は Map に載せず、件数のみの表示へ退避させる
        for (const result of settled) {
            if (result.status === "fulfilled") {
                lotsByItemId.set(result.value.itemId, result.value.lots);
            }
        }
    }
    return lotsByItemId;
};
