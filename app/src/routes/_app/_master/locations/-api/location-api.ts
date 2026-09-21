import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ItemDto } from "@/domain/item";
import {
    type LocationCreateInput,
    type LocationDto,
    type LocationUpdateInput,
    locationCreateInputSchema,
    locationIdSchema,
    locationUpdateInputSchema,
} from "@/domain/location";

/** 保管場所の個別ページに並べる品目。一覧と同じ DTO を使う。 */
export type LocationItemDto = ItemDto;

type LocationListResponse = { items: LocationDto[]; nextCursor: string | null };

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

// 更新も読み取りと同じ server function 境界から service を直接呼ぶ。
// 画面は API トークンを持たず、/api の HTTP 経路を通らない。
const createLocationServerFn = createServerFn({ method: "POST" })
    .validator(locationCreateInputSchema)
    .handler(async ({ data }): Promise<LocationDto> => {
        const [{ env }, { createLocation: create, LocationServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/locationService"),
            ]);
        try {
            return await create(env.DB, data);
        } catch (error) {
            if (error instanceof LocationServiceError) {
                throw new Error(error.message);
            }
            throw new Error("保管場所の更新に失敗しました");
        }
    });

const updateLocationServerFn = createServerFn({ method: "POST" })
    .validator(
        z.object({
            id: locationIdSchema,
            input: locationUpdateInputSchema,
        }),
    )
    .handler(async ({ data }): Promise<LocationDto> => {
        const [{ env }, { updateLocation: update, LocationServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/locationService"),
            ]);
        try {
            return await update(env.DB, data.id, data.input);
        } catch (error) {
            if (error instanceof LocationServiceError) {
                throw new Error(error.message);
            }
            throw new Error("保管場所の更新に失敗しました");
        }
    });

const deleteLocationServerFn = createServerFn({ method: "POST" })
    .validator(locationIdSchema)
    .handler(async ({ data }): Promise<{ deleted: true }> => {
        const [{ env }, { removeLocation, LocationServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/locationService"),
            ]);
        try {
            await removeLocation(env.DB, data);
            return { deleted: true };
        } catch (error) {
            if (error instanceof LocationServiceError) {
                throw new Error(error.message);
            }
            throw new Error("保管場所の更新に失敗しました");
        }
    });

export const createLocation = (
    input: LocationCreateInput,
): Promise<LocationDto> => createLocationServerFn({ data: input });

export const updateLocation = (
    id: string,
    input: LocationUpdateInput,
): Promise<LocationDto> => updateLocationServerFn({ data: { id, input } });

export const deleteLocation = (id: string): Promise<{ deleted: true }> =>
    deleteLocationServerFn({ data: id });

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
