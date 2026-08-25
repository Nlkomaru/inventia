import { describe, expect, it } from "vitest";
import { collectDescendantIds } from "./hierarchy";

const categories = [
    { id: "food", name: "食品", parentId: null },
    { id: "drink", name: "飲料", parentId: "food" },
    { id: "tea", name: "お茶", parentId: "drink" },
    { id: "book", name: "書籍", parentId: null },
] as const;

describe("collectDescendantIds", () => {
    it("選択したカテゴリ自身とすべての子孫を返す", () => {
        expect(collectDescendantIds(categories, "food")).toEqual(
            new Set(["food", "drink", "tea"]),
        );
    });

    it("存在しないカテゴリは一致対象を返さない", () => {
        expect(collectDescendantIds(categories, "missing")).toEqual(new Set());
    });

    it("親子の循環があっても重複せず終了する", () => {
        const cyclicCategories = [
            { id: "a", name: "A", parentId: "b" },
            { id: "b", name: "B", parentId: "a" },
        ];

        expect(collectDescendantIds(cyclicCategories, "a")).toEqual(
            new Set(["a", "b"]),
        );
    });
});
