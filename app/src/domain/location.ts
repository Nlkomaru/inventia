import { z } from "zod";

/** The identifier format used by storage_locations. */
export const locationIdSchema = z.string().trim().min(1).max(128);

/** Names are normalized at the input boundary so sibling uniqueness is predictable. */
export const locationNameSchema = z
    .string()
    .trim()
    .min(1, "場所名は必須です")
    .max(200, "場所名は200文字以内で入力してください");

/** SQLite INTEGER is a signed 64-bit value; this narrower range is portable to API clients. */
export const locationSortOrderSchema = z
    .number()
    .int("並び順は整数で指定してください")
    .min(-2_147_483_648)
    .max(2_147_483_647);

export const locationCreateInputSchema = z
    .object({
        name: locationNameSchema,
        parentId: locationIdSchema.nullable().optional().default(null),
        sortOrder: locationSortOrderSchema.optional().default(0),
    })
    .strict();

export const locationUpdateInputSchema = z
    .object({
        name: locationNameSchema.optional(),
        parentId: locationIdSchema.nullable().optional(),
        sortOrder: locationSortOrderSchema.optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "更新する項目を1つ以上指定してください",
    });

export const locationListInputSchema = z.object({
    parentId: locationIdSchema.nullable().default(null),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(512).optional(),
});

export const locationCursorSchema = z.object({
    sortOrder: locationSortOrderSchema,
    id: locationIdSchema,
});

export const locationDtoSchema = z
    .object({
        id: locationIdSchema,
        name: locationNameSchema,
        parentId: locationIdSchema.nullable(),
        sortOrder: locationSortOrderSchema,
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

export type LocationId = z.infer<typeof locationIdSchema>;
export type LocationCreateInput = z.infer<typeof locationCreateInputSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateInputSchema>;
export type LocationListInput = z.infer<typeof locationListInputSchema>;
export type LocationCursor = z.infer<typeof locationCursorSchema>;
export type LocationDto = z.infer<typeof locationDtoSchema>;

const toBase64Url = (value: string): string =>
    btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

const fromBase64Url = (value: string): string => {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
};

/** Cursors are opaque to clients while retaining the (sort_order, id) key. */
export const encodeLocationCursor = (cursor: LocationCursor): string =>
    toBase64Url(JSON.stringify(locationCursorSchema.parse(cursor)));

export const decodeLocationCursor = (cursor: string): LocationCursor | null => {
    try {
        const decoded = fromBase64Url(cursor);
        const parsed: unknown = JSON.parse(decoded);
        const result = locationCursorSchema.safeParse(parsed);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};

export const normalizeLocationCreateInput = (
    input: LocationCreateInput,
): LocationCreateInput => locationCreateInputSchema.parse(input);

export const normalizeLocationUpdateInput = (
    input: LocationUpdateInput,
): LocationUpdateInput => locationUpdateInputSchema.parse(input);
