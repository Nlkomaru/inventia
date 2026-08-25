import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCategory } from "../services/categoryService";
import { createItem, listItems } from "../services/itemService";
import { createLocation } from "../services/locationService";

describe("品目一覧の SQL 並べ替え", () => {
    it("関連マスタ名・単位を D1 で並べ替え、降順 cursor を継続する", async () => {
        const marker = crypto.randomUUID();
        const [firstCategory, secondCategory, firstLocation, secondLocation] =
            await Promise.all([
                createCategory(env.DB, { name: `a-category-${marker}` }),
                createCategory(env.DB, { name: `z-category-${marker}` }),
                createLocation(env.DB, { name: `z-location-${marker}` }),
                createLocation(env.DB, { name: `a-location-${marker}` }),
            ]);
        const [first, second] = await Promise.all([
            createItem(env.DB, {
                name: `z-item-${marker}`,
                categoryId: firstCategory.id,
                locationId: firstLocation.id,
                baseUnit: "z-unit",
                baseDimension: "count",
            }),
            createItem(env.DB, {
                name: `a-item-${marker}`,
                categoryId: secondCategory.id,
                locationId: secondLocation.id,
                baseUnit: "a-unit",
                baseDimension: "count",
            }),
        ]);

        const categoryAscending = await listItems(env.DB, {
            q: marker,
            sort: "category",
            sortDirection: "asc",
            limit: 1,
        });
        expect(categoryAscending.items.map((item) => item.id)).toEqual([
            first.id,
        ]);
        expect(categoryAscending.nextCursor).not.toBeNull();

        const categoryAscendingNext = await listItems(env.DB, {
            q: marker,
            sort: "category",
            sortDirection: "asc",
            limit: 1,
            cursor: categoryAscending.nextCursor ?? undefined,
        });
        expect(categoryAscendingNext.items.map((item) => item.id)).toEqual([
            second.id,
        ]);

        const categoryDescending = await listItems(env.DB, {
            q: marker,
            sort: "category",
            sortDirection: "desc",
            limit: 10,
        });
        expect(categoryDescending.items.map((item) => item.id)).toEqual([
            second.id,
            first.id,
        ]);

        const locationAscending = await listItems(env.DB, {
            q: marker,
            sort: "location",
            sortDirection: "asc",
            limit: 10,
        });
        expect(locationAscending.items.map((item) => item.id)).toEqual([
            second.id,
            first.id,
        ]);

        const unitAscending = await listItems(env.DB, {
            q: marker,
            sort: "baseUnit",
            sortDirection: "asc",
            limit: 10,
        });
        expect(unitAscending.items.map((item) => item.id)).toEqual([
            second.id,
            first.id,
        ]);
    });
});
