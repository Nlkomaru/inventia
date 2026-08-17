import { z } from "zod";
import {
    type CategoryDto,
    categoryDtoSchema,
    categoryListOutputSchema,
} from "@/domain/category";
import {
    type ItemCreateInput,
    type ItemDetailDto,
    type ItemDto,
    type ItemUpdateInput,
    itemCreateSchema,
    itemDetailDtoSchema,
    itemDtoSchema,
    itemUpdateSchema,
} from "@/domain/item";
import {
    type LocationDto,
    locationDtoSchema,
    locationListOutputSchema,
} from "@/domain/location";
import {
    type ReadingStateDto,
    type ReadingStateUpsertInput,
    readingStateDtoSchema,
    readingStateUpsertSchema,
} from "@/domain/reading";

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

const itemDeleteOutputSchema = z.object({
    deleted: z.literal(true),
});

const request = async <T>(
    url: string,
    schema: z.ZodType<T>,
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
                : "品目の更新に失敗しました",
        );
    }
    return schema.parse(await response.json());
};

// 本文の形を使わない応答（204 と JSON のどちらも返り得る）はここで読み捨てる
const requestEmpty = async (url: string, init: RequestInit): Promise<void> => {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = apiErrorSchema.safeParse(
            await response.json().catch(() => ({})),
        );
        throw new Error(
            body.success && body.data.error?.message
                ? body.data.error.message
                : "品目の更新に失敗しました",
        );
    }
    await response.text();
};

const withCursor = (url: string, cursor: string | undefined): string => {
    if (!cursor) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}cursor=${encodeURIComponent(cursor)}`;
};

export const listItems = async (): Promise<ItemDto[]> => {
    const items: ItemDto[] = [];
    let cursor: string | undefined;
    do {
        const url = withCursor("/api/items?limit=100", cursor);
        const page = await request(url, itemListOutputSchema);
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
};

const listCategoryLevel = async (
    parentId: string | null,
): Promise<CategoryDto[]> => {
    const items: CategoryDto[] = [];
    let cursor: string | undefined;
    do {
        const params = new URLSearchParams({ limit: "100" });
        if (parentId) params.set("parentId", parentId);
        if (cursor) params.set("cursor", cursor);
        const page = await request(
            `/api/categories?${params.toString()}`,
            categoryListOutputSchema,
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
};

export const listCategories = async (): Promise<CategoryDto[]> => {
    const categories: CategoryDto[] = [];
    const visit = async (parentId: string | null): Promise<void> => {
        const level = await listCategoryLevel(parentId);
        categories.push(...level);
        for (const category of level) await visit(category.id);
    };
    await visit(null);
    return categories;
};

const listLocationLevel = async (
    parentId: string | null,
): Promise<LocationDto[]> => {
    const items: LocationDto[] = [];
    let cursor: string | undefined;
    do {
        const params = new URLSearchParams({ limit: "100" });
        if (parentId) params.set("parentId", parentId);
        if (cursor) params.set("cursor", cursor);
        const page = await request(
            `/api/locations?${params.toString()}`,
            locationListOutputSchema,
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
};

export const listLocations = async (): Promise<LocationDto[]> => {
    const locations: LocationDto[] = [];
    const visit = async (parentId: string | null): Promise<void> => {
        const level = await listLocationLevel(parentId);
        locations.push(...level);
        for (const location of level) await visit(location.id);
    };
    await visit(null);
    return locations;
};

export const createItem = (input: ItemCreateInput): Promise<ItemDto> =>
    request("/api/items", itemDtoSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(itemCreateSchema.parse(input)),
    });

export const updateItem = (
    id: string,
    input: ItemUpdateInput,
): Promise<ItemDto> =>
    request(`/api/items/${encodeURIComponent(id)}`, itemDtoSchema, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(itemUpdateSchema.parse(input)),
    });

export const deleteItem = (id: string): Promise<{ deleted: true }> =>
    request(`/api/items/${encodeURIComponent(id)}`, itemDeleteOutputSchema, {
        method: "DELETE",
    });

// 一覧 DTO は読書状態の有無しか持たないため、開始日と読了日は詳細から取る
export const getItem = (id: string): Promise<ItemDetailDto> =>
    request(`/api/items/${encodeURIComponent(id)}`, itemDetailDtoSchema);

export const setReadingState = (
    itemId: string,
    input: ReadingStateUpsertInput,
): Promise<ReadingStateDto> =>
    request(
        `/api/items/${encodeURIComponent(itemId)}/reading-state`,
        readingStateDtoSchema,
        {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(readingStateUpsertSchema.parse(input)),
        },
    );

// 読書状態だけを消す。在庫と品目には影響しない
export const clearReadingState = (itemId: string): Promise<void> =>
    requestEmpty(`/api/items/${encodeURIComponent(itemId)}/reading-state`, {
        method: "DELETE",
    });

export { categoryDtoSchema, locationDtoSchema };
