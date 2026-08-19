import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CategoryDto } from "@/domain/category";
import {
    type ItemCreateInput,
    type ItemDto,
    itemCreateSchema,
    itemDtoSchema,
} from "@/domain/item";
import type { LocationDto } from "@/domain/location";

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

// カテゴリと保管場所は階層を丸ごと使う。親を辿って表示名を組み立てるため、
// 1 階層ずつ返す service を cursor が尽きるまで辿って全件集める
export const listCategoryTree = createServerFn({ method: "GET" }).handler(
    async (): Promise<CategoryDto[]> => {
        const [{ env }, { listCategories }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/categoryService"),
        ]);
        const result: CategoryDto[] = [];
        const visit = async (parentId: string | null): Promise<void> => {
            const start = result.length;
            let cursor: string | undefined;
            do {
                const page = await listCategories(env.DB, {
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

/**
 * 品目を作る。初期数量と期限を一緒に送ると、品目・ロット・在庫履歴が
 * 1 回の書き込みで揃うため、途中失敗で在庫 0 の品目だけが残らない。
 */
export const createItem = (input: ItemCreateInput): Promise<ItemDto> =>
    request("/api/items", itemDtoSchema, "品目を登録できませんでした", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(itemCreateSchema.parse(input)),
    });
