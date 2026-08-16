import type { CategoryKind } from "@/domain/category";

type HierarchyNode = {
    id: string;
    name: string;
    parentId: string | null;
};

type KindHierarchyNode = HierarchyNode & {
    kind: CategoryKind | null;
};

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

export const getHierarchyLabels = <T extends HierarchyNode>(
    nodes: readonly T[],
): Map<string, string> => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const labels = new Map<string, string>();
    for (const node of nodes) {
        const names: string[] = [];
        const visited = new Set<string>();
        let currentId: string | null = node.id;
        while (currentId && !visited.has(currentId)) {
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
