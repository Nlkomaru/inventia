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

/** 根から対象までの並び。循環していても止まる。対象が無ければ空配列。 */
export const buildAncestry = <T extends HierarchyNode>(
    nodes: readonly T[],
    id: string,
): T[] => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const ancestry: T[] = [];
    const visited = new Set<string>();
    let current = byId.get(id);
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        ancestry.unshift(current);
        current =
            current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return ancestry;
};

/**
 * 祖先を根から並べた URL の、基点より後ろの部分。カテゴリーと保管場所は
 * どちらも `/{基点}/{祖先}/…/{対象}` の形で個別ページを持つ。
 * 対象が見つからない場合は空文字。
 */
export const buildAncestrySplat = <T extends HierarchyNode>(
    nodes: readonly T[],
    id: string,
): string =>
    buildAncestry(nodes, id)
        .map((node) => encodeURIComponent(node.id))
        .join("/");

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
