import type { CategoryKind } from "@/domain/category";

// カテゴリ・保管場所は親子構造を持つ。表示名の組み立てと、種別の継承を
// 画面ごとに書き分けると挙動がずれるため、ここへ集約する。

interface HierarchyNode {
    id: string;
    name: string;
    parentId: string | null;
}

type KindHierarchyNode = HierarchyNode & {
    kind: CategoryKind | null;
};

/** 階層をたどって「親 / 子」の表示名を作る。循環していても止まる。 */
export const buildHierarchyLabels = <T extends HierarchyNode>(
    nodes: readonly T[],
): Map<string, string> => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const labels = new Map<string, string>();
    for (const node of nodes) {
        const names: string[] = [];
        const visited = new Set<string>();
        let currentId: string | null = node.id;
        while (currentId !== null && !visited.has(currentId)) {
            visited.add(currentId);
            const current = byId.get(currentId);
            if (!current) break;
            names.push(current.name);
            currentId = current.parentId;
        }
        labels.set(node.id, names.reverse().join(" / "));
    }
    return labels;
};

/**
 * 実効的なカテゴリー種別。自分に種別が無ければ祖先から継承する。
 * service 側（repositories の getCategoryKind）と同じ規則で、
 * 種別が document の品目だけ基準単位を省略できる。
 */
export const getEffectiveCategoryKind = (
    categoryId: string | null,
    nodes: readonly KindHierarchyNode[],
): CategoryKind | null => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const visited = new Set<string>();
    let currentId = categoryId;
    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const current = byId.get(currentId);
        if (!current) break;
        if (current.kind) return current.kind;
        currentId = current.parentId;
    }
    return null;
};
