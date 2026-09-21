import { createServerFn } from "@tanstack/react-start";
import type { CategoryDto } from "@/domain/category";
import {
    type ItemCreateInput,
    type ItemDto,
    itemCreateSchema,
} from "@/domain/item";
import type { LocationDto } from "@/domain/location";

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

// カテゴリは service が階層を 1 クエリで返す。保管場所は同等の service が
// 無いため、1 階層ずつ返す一覧を親から辿って集める
export const listCategoryTree = createServerFn({ method: "GET" }).handler(
    async (): Promise<CategoryDto[]> => {
        const [{ env }, { listCategoryTree: fetchCategoryTree }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/categoryService"),
            ]);
        const tree = await fetchCategoryTree(env.DB);
        return tree.items;
    },
);

export const listLocationTree = createServerFn({ method: "GET" }).handler(
    async (): Promise<LocationDto[]> => {
        const [{ env }, { listLocations }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/locationService"),
        ]);
        const result: LocationDto[] = [];
        const visit = async (parentId: string | null): Promise<void> => {
            const start = result.length;
            let cursor: string | undefined;
            do {
                const page = await listLocations(env.DB, {
                    parentId,
                    limit: 100,
                    ...(cursor === undefined ? {} : { cursor }),
                });
                result.push(...page.items);
                cursor = page.nextCursor ?? undefined;
            } while (cursor);
            for (const child of result.slice(start)) await visit(child.id);
        };
        await visit(null);
        return result;
    },
);

// 更新も読み取りと同じ server function 境界から service を直接呼ぶ。
// 画面は API トークンを持たず、/api の HTTP 経路を通らない。
const createItemServerFn = createServerFn({ method: "POST" })
    .validator(itemCreateSchema)
    .handler(async ({ data }): Promise<ItemDto> => {
        const [
            { env },
            { createItem: create, ItemServiceError },
            { indexItem },
        ] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/itemService"),
            import("@/services/itemSearchService"),
        ]);
        try {
            const created = await create(env.DB, data);
            // 索引更新は HTTP 経路（POST /api/items）と同じく best-effort。
            // service 内部で失敗を飲み込むため、登録の成否には影響しない
            await indexItem(env, created.id);
            return created;
        } catch (error) {
            if (error instanceof ItemServiceError) {
                throw new Error(error.message);
            }
            throw new Error("品目を登録できませんでした");
        }
    });

/**
 * 品目を作る。初期数量と期限を一緒に送ると、品目・ロット・在庫履歴が
 * 1 回の書き込みで揃うため、途中失敗で在庫 0 の品目だけが残らない。
 */
export const createItem = (input: ItemCreateInput): Promise<ItemDto> =>
    createItemServerFn({ data: itemCreateSchema.parse(input) });
