import type { CategoryDto, CategoryKind } from "@/domain/category";

export const categoryKindLabels: Record<CategoryKind, string> = {
    daily_goods: "日用品",
    food: "食料品",
    book: "書籍",
    document: "書類",
};

export const categoryKindUnsetLabel = "未設定";

type CategoryKindNode = Pick<CategoryDto, "id" | "parentId" | "kind">;

export type EffectiveCategoryKind = {
    kind: CategoryKind | null;
    inherited: boolean;
};

export type CategoryKindIndex = ReadonlyMap<string, CategoryKindNode>;

/** 行ごとに Map を作り直さないよう、一覧に対して 1 度だけ索引を作る。 */
export const createCategoryKindIndex = (
    nodes: readonly CategoryKindNode[],
): CategoryKindIndex => new Map(nodes.map((node) => [node.id, node]));

/**
 * kind が null のカテゴリは祖先を遡って実効 kind を決める。
 * 壊れた親子関係でも停止するよう訪問済み ID で打ち切る。
 */
export const resolveEffectiveCategoryKind = (
    categoryId: string | null,
    byId: CategoryKindIndex,
): EffectiveCategoryKind => {
    const visited = new Set<string>();
    let currentId = categoryId;
    let inherited = false;
    while (currentId !== null && !visited.has(currentId)) {
        visited.add(currentId);
        const current = byId.get(currentId);
        if (current === undefined) break;
        if (current.kind !== null) return { kind: current.kind, inherited };
        inherited = true;
        currentId = current.parentId;
    }
    return { kind: null, inherited: false };
};

export const formatEffectiveCategoryKind = (
    effective: EffectiveCategoryKind,
): string => {
    if (effective.kind === null) return categoryKindUnsetLabel;
    const label = categoryKindLabels[effective.kind];
    return effective.inherited ? `継承: ${label}` : label;
};
