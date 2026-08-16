import { z } from "zod";
import {
    type CategoryDto,
    categoryDtoSchema,
    categoryListOutputSchema,
} from "@/domain/category";
import {
    type ItemCreateInput,
    type ItemDto,
    type ItemUpdateInput,
    itemCreateSchema,
    itemDtoSchema,
    itemUpdateSchema,
} from "@/domain/item";
import {
    type LocationDto,
    locationDtoSchema,
    locationListOutputSchema,
} from "@/domain/location";

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

export { categoryDtoSchema, locationDtoSchema };
