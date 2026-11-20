import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCategory } from "./categoryService";
import {
    createItem,
    getItem,
    getItems,
    ItemServiceError,
    linkItemRelation,
    listItems,
    unlinkItemRelation,
    updateItem,
} from "./itemService";
import { createLocation } from "./locationService";

// 0001_seed_base_categories.sql が投入するルートカテゴリ
const dailyGoodsId = "019fdcef-ee13-7178-9c19-2a5bde5c3778";

const createTestFixtures = async (suffix: string) => {
    const category = await createCategory(env.DB, {
        name: `テストカテゴリ-${suffix}`,
        parentId: dailyGoodsId,
    });
    const location = await createLocation(env.DB, {
        name: `テスト保管場所-${suffix}`,
    });
    return { categoryId: category.id, locationId: location.id };
};

describe("itemService parent-child relations", () => {
    it("親子関係を紐付けると parentItem / childItems / familyTotalQuantity が各読み取り API に反映される", async () => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { categoryId, locationId } = await createTestFixtures(suffix);

        const parent = await createItem(env.DB, {
            name: `醤油-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "mL",
            baseDimension: "volume",
            currentQuantity: 500,
        });
        const child1 = await createItem(env.DB, {
            name: `醤油予備-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "mL",
            baseDimension: "volume",
            currentQuantity: 1000,
        });
        const child2 = await createItem(env.DB, {
            name: `醤油詰め替え-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "mL",
            baseDimension: "volume",
            currentQuantity: 750,
        });

        // 未紐付け時は familyTotalQuantity === currentQuantity
        expect(parent.familyTotalQuantity).toBe(500);
        expect(parent.parentItem).toBeNull();
        expect(parent.childItems).toEqual([]);

        const rel1 = await linkItemRelation(env.DB, {
            parentItemId: parent.id,
            childItemId: child1.id,
            label: "予備",
        });
        expect(rel1.parentItemId).toBe(parent.id);
        expect(rel1.childItemId).toBe(child1.id);
        expect(rel1.label).toBe("予備");

        await linkItemRelation(env.DB, {
            parentItemId: parent.id,
            childItemId: child2.id,
            label: "詰め替え",
        });

        // getItem: 親品目
        const parentDetail = await getItem(env.DB, parent.id);
        expect(parentDetail.familyTotalQuantity).toBe(2250);
        expect(parentDetail.parentItem).toBeNull();
        expect(parentDetail.childItems).toHaveLength(2);
        expect(parentDetail.childItems.map((c) => c.id).sort()).toEqual(
            [child1.id, child2.id].sort(),
        );

        // getItem: 子品目単体で読んでも親と兄弟を含めた familyTotalQuantity が返る
        const child1Detail = await getItem(env.DB, child1.id);
        expect(child1Detail.familyTotalQuantity).toBe(2250);
        expect(child1Detail.parentItem).toEqual({
            id: parent.id,
            name: parent.name,
            currentQuantity: 500,
            baseUnit: "mL",
            label: "予備",
        });
        expect(child1Detail.childItems).toEqual([]);

        // getItems: 子品目だけを指定したバッチ取得でも姉妹を含めて合計される
        const batchChildOnly = await getItems(env.DB, [child2.id]);
        expect(batchChildOnly.items[0]?.familyTotalQuantity).toBe(2250);
        expect(batchChildOnly.items[0]?.parentItem?.id).toBe(parent.id);

        // listItems: 子品目のみヒットする検索でも familyTotalQuantity が正確
        const listed = await listItems(env.DB, { q: `醤油詰め替え-${suffix}` });
        expect(listed.items).toHaveLength(1);
        expect(listed.items[0]?.familyTotalQuantity).toBe(2250);
        expect(listed.items[0]?.parentItem?.label).toBe("詰め替え");

        // 解除すると元の個別数量へ戻る
        const unlinked = await unlinkItemRelation(env.DB, {
            parentItemId: parent.id,
            childItemId: child1.id,
        });
        expect(unlinked).toEqual({ unlinked: true });

        const parentAfterUnlink = await getItem(env.DB, parent.id);
        expect(parentAfterUnlink.familyTotalQuantity).toBe(1250);
        expect(parentAfterUnlink.childItems).toHaveLength(1);

        const child1AfterUnlink = await getItem(env.DB, child1.id);
        expect(child1AfterUnlink.familyTotalQuantity).toBe(1000);
        expect(child1AfterUnlink.parentItem).toBeNull();
    });

    it("自己参照・存在しない品目・単位不一致を拒否する", async () => {
        const suffix = crypto.randomUUID();
        const { categoryId, locationId } = await createTestFixtures(suffix);

        const mlItem = await createItem(env.DB, {
            name: `洗剤本体-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "mL",
            baseDimension: "volume",
        });
        const lItem = await createItem(env.DB, {
            name: `洗剤L-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "L",
            baseDimension: "volume",
        });
        const gItem = await createItem(env.DB, {
            name: `粉洗剤-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "g",
            baseDimension: "mass",
        });

        await expect(
            linkItemRelation(env.DB, {
                parentItemId: mlItem.id,
                childItemId: mlItem.id,
            }),
        ).rejects.toMatchObject({
            status: 400,
            code: "VALIDATION_ERROR",
        });

        await expect(
            linkItemRelation(env.DB, {
                parentItemId: mlItem.id,
                childItemId: "00000000-0000-0000-0000-000000000000",
            }),
        ).rejects.toMatchObject({
            status: 404,
            code: "ITEM_NOT_FOUND",
        });

        // 同じ次元でも baseUnit が異なれば拒否
        await expect(
            linkItemRelation(env.DB, {
                parentItemId: mlItem.id,
                childItemId: lItem.id,
            }),
        ).rejects.toMatchObject({
            status: 409,
            code: "ITEM_RELATION_UNIT_CONFLICT",
        });

        // baseDimension が異なれば拒否
        await expect(
            linkItemRelation(env.DB, {
                parentItemId: mlItem.id,
                childItemId: gItem.id,
            }),
        ).rejects.toMatchObject({
            status: 409,
            code: "ITEM_RELATION_UNIT_CONFLICT",
        });
    });

    it("1 階層のみの制約（多段ネストと複数親）を拒否する", async () => {
        const suffix = crypto.randomUUID();
        const { categoryId, locationId } = await createTestFixtures(suffix);

        const a = await createItem(env.DB, {
            name: `品目A-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "本",
            baseDimension: "count",
        });
        const b = await createItem(env.DB, {
            name: `品目B-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "本",
            baseDimension: "count",
        });
        const c = await createItem(env.DB, {
            name: `品目C-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "本",
            baseDimension: "count",
        });
        const d = await createItem(env.DB, {
            name: `品目D-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "本",
            baseDimension: "count",
        });

        await linkItemRelation(env.DB, {
            parentItemId: a.id,
            childItemId: b.id,
        });

        // 既に子である B を親にしようとすると拒否
        await expect(
            linkItemRelation(env.DB, {
                parentItemId: b.id,
                childItemId: c.id,
            }),
        ).rejects.toMatchObject({
            status: 409,
            code: "ITEM_RELATION_HIERARCHY_CONFLICT",
        });

        // 既に親である A を別の子にしようとすると拒否
        await expect(
            linkItemRelation(env.DB, {
                parentItemId: c.id,
                childItemId: a.id,
            }),
        ).rejects.toMatchObject({
            status: 409,
            code: "ITEM_RELATION_HIERARCHY_CONFLICT",
        });

        // 既に親 A を持つ B に別の親 D を付けようとすると拒否
        await expect(
            linkItemRelation(env.DB, {
                parentItemId: d.id,
                childItemId: b.id,
            }),
        ).rejects.toMatchObject({
            status: 409,
            code: "ITEM_RELATION_CONFLICT",
        });
    });

    it("関係を持つ品目は baseUnit / baseDimension を変更できず、解除後は変更できる", async () => {
        const suffix = crypto.randomUUID();
        const { categoryId, locationId } = await createTestFixtures(suffix);

        const parent = await createItem(env.DB, {
            name: `柔軟剤-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "mL",
            baseDimension: "volume",
        });
        const child = await createItem(env.DB, {
            name: `柔軟剤詰め替え-${suffix}`,
            categoryId,
            locationId,
            baseUnit: "mL",
            baseDimension: "volume",
        });

        await linkItemRelation(env.DB, {
            parentItemId: parent.id,
            childItemId: child.id,
        });

        // 名前だけの変更は許可される
        const renamed = await updateItem(env.DB, parent.id, {
            name: `柔軟剤改-${suffix}`,
        });
        expect(renamed.childItems).toHaveLength(1);

        // 親でも子でも baseUnit / baseDimension の変更は拒否される
        await expect(
            updateItem(env.DB, parent.id, { baseUnit: "L" }),
        ).rejects.toBeInstanceOf(ItemServiceError);

        await expect(
            updateItem(env.DB, child.id, {
                baseUnit: "g",
                baseDimension: "mass",
            }),
        ).rejects.toMatchObject({
            status: 409,
            code: "ITEM_RELATION_UNIT_CONFLICT",
        });

        // 解除後は変更できる
        await unlinkItemRelation(env.DB, {
            parentItemId: parent.id,
            childItemId: child.id,
        });
        const updatedChild = await updateItem(env.DB, child.id, {
            baseUnit: "L",
        });
        expect(updatedChild.baseUnit).toBe("L");

        // 存在しない関係の解除は 404
        await expect(
            unlinkItemRelation(env.DB, {
                parentItemId: parent.id,
                childItemId: child.id,
            }),
        ).rejects.toMatchObject({
            status: 404,
            code: "ITEM_RELATION_NOT_FOUND",
        });
    });
});
