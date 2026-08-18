// カテゴリ・保管場所の階層をたどって「親 / 子」の表示名を作る。
// 品目マスタ画面にも同じ処理があるが、ルート専用ディレクトリ同士を参照させないため
// ここに持つ（共有するなら app/src/lib へ引き上げる）。

interface HierarchyNode {
    id: string;
    name: string;
    parentId: string | null;
}

export const buildHierarchyLabels = <T extends HierarchyNode>(
    nodes: readonly T[],
): Map<string, string> => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const labels = new Map<string, string>();
    for (const node of nodes) {
        const names: string[] = [];
        const visited = new Set<string>();
        let currentId: string | null = node.id;
        // 親を辿る途中で循環していても止まるようにする
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
