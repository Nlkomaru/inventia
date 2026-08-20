import { createServerFn } from "@tanstack/react-start";
import type { ItemDto } from "@/domain/item";
import {
    type LocationCreateInput,
    type LocationDto,
    type LocationUpdateInput,
    locationIdSchema,
} from "@/domain/location";

/** 保管場所の個別ページに並べる品目。一覧と同じ DTO を使う。 */
export type LocationItemDto = ItemDto;

type LocationListResponse = { items: LocationDto[]; nextCursor: string | null };
type ApiError = { error?: { message?: string } };

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? "保管場所の更新に失敗しました");
    }
    return (await response.json()) as T;
};

/** 保管場所ツリーと、場所ごとの品目件数（自身に直接紐づく件数のみ）。 */
export type LocationTree = {
    locations: LocationDto[];
    /** 場所 id ごとの品目件数。件数が 0 の場所は含まれない。 */
    itemCounts: Record<string, number>;
};

export const listLocationTree = createServerFn({ method: "GET" }).handler(
    async (): Promise<LocationTree> => {
        const [{ env }, { listLocations }, { countItemsByLocation }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/locationService"),
                import("@/services/itemService"),
            ]);
        const locations: LocationDto[] = [];
        const listLevel = async (parentId: string | null) => {
            let cursor: string | undefined;
            do {
                const page: LocationListResponse = await listLocations(env.DB, {
                    parentId,
                    limit: 100,
                    cursor,
                });
                locations.push(...page.items);
                cursor = page.nextCursor ?? undefined;
            } while (cursor);
        };
        const visit = async (parentId: string | null) => {
            const start = locations.length;
            await listLevel(parentId);
            for (const child of locations.slice(start)) await visit(child.id);
        };
        await visit(null);
        return { locations, itemCounts: await countItemsByLocation(env.DB) };
    },
);

export const createLocation = (input: LocationCreateInput) =>
    request<LocationDto>("/api/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
    });

export const updateLocation = (id: string, input: LocationUpdateInput) =>
    request<LocationDto>(`/api/locations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
    });

export const deleteLocation = (id: string) =>
    request<{ deleted: true }>(`/api/locations/${id}`, { method: "DELETE" });

/**
 * 保管場所 1 つに直接置かれている品目。子孫の場所の分は含めない
 * （階層をまたぐ合算は場所ツリーを持つ画面側の責務、という service の分担に合わせる）。
 */
export const listLocationItems = createServerFn({ method: "GET" })
    .validator((input: unknown) => locationIdSchema.parse(input))
    .handler(async ({ data }): Promise<LocationItemDto[]> => {
        const [{ env }, { listItems }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/itemService"),
        ]);
        const items: LocationItemDto[] = [];
        let cursor: string | undefined;
        do {
            const page = await listItems(env.DB, {
                locationId: data,
                limit: 100,
                cursor,
            });
            items.push(...page.items);
            cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return items;
    });
