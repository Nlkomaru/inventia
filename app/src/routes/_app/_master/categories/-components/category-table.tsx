import {
    createColumnHelper,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { useAtom, useSetAtom } from "jotai";
import {
    ChevronDown,
    ChevronRight,
    Pencil,
    Search,
    Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { CategoryDto } from "@/domain/category";
import { cn } from "@/lib/utils";
import {
    createCategoryKindIndex,
    type EffectiveCategoryKind,
    formatEffectiveCategoryKind,
    resolveEffectiveCategoryKind,
} from "../-functions/effective-kind";
import {
    categoryQueryAtom,
    editingCategoryIdAtom,
    expandedCategoryIdsAtom,
} from "./category-atoms";

// 行ごとに変わる値・ハンドラはすべて行データへ持たせる。
// columns をモジュール定数に固定し、展開や削除のたびにセルが再マウントされないようにする
// （FlexRender は cell 関数を component type として扱うため、関数の同一性が焦点を左右する）。
type CategoryTableRow = {
    item: CategoryDto;
    depth: number;
    canExpand: boolean;
    isExpanded: boolean;
    canDelete: boolean;
    effectiveKind: EffectiveCategoryKind;
    onToggle: () => void;
    onEdit: () => void;
    onDelete: () => void;
};

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, CategoryTableRow>();

const columns = columnHelper.columns([
    columnHelper.display({
        id: "name",
        header: "カテゴリ名",
        cell: ({ row }) => {
            const { canExpand, depth, isExpanded, item, onToggle } =
                row.original;
            return (
                <div
                    className="flex items-center"
                    style={{ paddingLeft: depth * 24 }}
                >
                    <Button
                        aria-expanded={canExpand ? isExpanded : undefined}
                        aria-label={`${item.name}を展開`}
                        disabled={!canExpand}
                        onClick={onToggle}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                    >
                        {isExpanded ? <ChevronDown /> : <ChevronRight />}
                    </Button>
                    <span>{item.name}</span>
                </div>
            );
        },
    }),
    columnHelper.display({
        id: "kind",
        header: "種別",
        cell: ({ row }) => {
            const { effectiveKind } = row.original;
            return (
                <span
                    className={cn(
                        (effectiveKind.kind === null ||
                            effectiveKind.inherited) &&
                            "text-muted-foreground",
                    )}
                >
                    {formatEffectiveCategoryKind(effectiveKind)}
                </span>
            );
        },
    }),
    columnHelper.accessor((row) => row.item.sortOrder, {
        id: "sortOrder",
        header: "並び順",
    }),
    columnHelper.display({
        id: "actions",
        header: "操作",
        cell: ({ row }) => {
            const { canDelete, item, onDelete, onEdit } = row.original;
            return (
                <div className="flex justify-end">
                    <Button
                        aria-label={`${item.name}を編集`}
                        onClick={onEdit}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                    >
                        <Pencil />
                    </Button>
                    <Button
                        aria-label={`${item.name}を削除`}
                        disabled={!canDelete}
                        onClick={onDelete}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                    >
                        <Trash2 />
                    </Button>
                </div>
            );
        },
    }),
]);

export function CategoryTable({
    categories,
    onDelete,
}: {
    categories: CategoryDto[];
    onDelete: (id: string) => Promise<void>;
}) {
    const [query, setQuery] = useAtom(categoryQueryAtom);
    const [expanded, setExpanded] = useAtom(expandedCategoryIdsAtom);
    const setEditingId = useSetAtom(editingCategoryIdAtom);
    const data = useMemo<CategoryTableRow[]>(() => {
        const normalized = query.trim().toLocaleLowerCase("ja");
        const kindIndex = createCategoryKindIndex(categories);
        const parentIdsWithChildren = new Set(
            categories
                .map((candidate) => candidate.parentId)
                .filter((parentId): parentId is string => parentId !== null),
        );
        // 絞り込み中は子孫を並べないため、展開操作も無効にして表示と状態を一致させる
        const filtering = normalized !== "";
        const toRow = (item: CategoryDto, depth: number): CategoryTableRow => {
            const hasChildren = parentIdsWithChildren.has(item.id);
            return {
                item,
                depth,
                canExpand: hasChildren && !filtering,
                isExpanded: !filtering && expanded.has(item.id),
                canDelete: !hasChildren,
                // 実効 kind は絞り込み後の行ではなく全カテゴリから解決する
                effectiveKind: resolveEffectiveCategoryKind(item.id, kindIndex),
                onToggle: () =>
                    setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(item.id)) {
                            next.delete(item.id);
                        } else {
                            next.add(item.id);
                        }
                        return next;
                    }),
                onEdit: () => setEditingId(item.id),
                onDelete: () => void onDelete(item.id),
            };
        };
        if (filtering) {
            return categories
                .filter((item) =>
                    item.name.toLocaleLowerCase("ja").includes(normalized),
                )
                .map((item) => toRow(item, 0));
        }

        const result: CategoryTableRow[] = [];
        const visit = (parentId: string | null, depth: number) => {
            for (const item of categories.filter(
                (candidate) => candidate.parentId === parentId,
            )) {
                result.push(toRow(item, depth));
                if (expanded.has(item.id)) visit(item.id, depth + 1);
            }
        };
        visit(null, 0);
        return result;
    }, [categories, expanded, onDelete, query, setEditingId, setExpanded]);
    const table = useTable({ columns, data, features });

    return (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b p-5">
                <div>
                    <h2 className="font-bold">登録済みカテゴリ</h2>
                    <p className="text-xs text-muted-foreground">
                        {categories.length} 件 · D1に保存されたカテゴリ
                    </p>
                </div>
                <label className="relative" htmlFor="category-search">
                    <Search className="absolute top-2.5 left-3 size-4" />
                    <span className="sr-only">検索</span>
                    <Input
                        id="category-search"
                        className="pl-9"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </label>
            </div>
            <Table className="min-w-[600px]" aria-label="登録済みカテゴリ">
                <TableHeader className="bg-muted/50">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <TableHead
                                    className={cn(
                                        "px-5",
                                        header.id === "actions" && "text-right",
                                    )}
                                    key={header.id}
                                    scope="col"
                                >
                                    {header.isPlaceholder
                                        ? null
                                        : table.FlexRender({ header })}
                                </TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {table.getRowModel().rows.length > 0 ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow key={row.original.item.id}>
                                {row.getAllCells().map((cell) => (
                                    <TableCell
                                        className="px-5 py-3"
                                        key={cell.id}
                                    >
                                        {table.FlexRender({ cell })}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell
                                className="h-24 text-center text-muted-foreground"
                                colSpan={columns.length}
                            >
                                カテゴリが登録されていません
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </section>
    );
}
