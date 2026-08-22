import { Link } from "@tanstack/react-router";
import {
    createColumnHelper,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { useAtom, useSetAtom } from "jotai";
import {
    ChevronDown,
    ChevronRight,
    Copy,
    Ellipsis,
    Pencil,
    Plus,
    Search,
    Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { buildCategorySplat } from "../-functions/category-path";
import {
    createCategoryKindIndex,
    type EffectiveCategoryKind,
    formatEffectiveCategoryKind,
    resolveEffectiveCategoryKind,
} from "../-functions/effective-kind";
import {
    categoryQueryAtom,
    expandedCategoryIdsAtom,
    startCategoryChildAtom,
    startCategoryEditAtom,
} from "./category-atoms";

// 行ごとに変わる値・ハンドラはすべて行データへ持たせる。
// columns をモジュール定数に固定し、展開や削除のたびにセルが再マウントされないようにする
// （FlexRender は cell 関数を component type として扱うため、関数の同一性が焦点を左右する）。
type CategoryTableRow = {
    item: CategoryDto;
    /** 個別ページの URL の余り。祖先を含むため行データとして持たせる。 */
    splat: string;
    depth: number;
    canExpand: boolean;
    isExpanded: boolean;
    canDelete: boolean;
    effectiveKind: EffectiveCategoryKind;
    onToggle: () => void;
    onCopyId: () => void;
    onEdit: () => void;
    onAddChild: () => void;
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
                    {canExpand ? (
                        <Button
                            aria-expanded={isExpanded}
                            aria-label={`${item.name}を展開`}
                            onClick={onToggle}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                        >
                            {isExpanded ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                    ) : (
                        // 子を持たない行も名前の開始位置を揃える
                        <span aria-hidden className="size-7" />
                    )}
                    <Link
                        className="underline-offset-4 hover:underline"
                        params={{ _splat: row.original.splat }}
                        to="/categories/$"
                    >
                        {item.name}
                    </Link>
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
            const { canDelete, item, onAddChild, onCopyId, onDelete, onEdit } =
                row.original;
            return (
                <div className="flex justify-end">
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            render={
                                <Button
                                    aria-label={`${item.name}の操作`}
                                    size="icon-sm"
                                    type="button"
                                    variant="ghost"
                                >
                                    <Ellipsis />
                                </Button>
                            }
                        />
                        <DropdownMenuContent
                            align="end"
                            // 既定では trigger 幅に揃うため項目名が折り返す
                            className="w-auto"
                        >
                            {/* Base UI では GroupLabel を Group の中に置く */}
                            <DropdownMenuGroup>
                                <DropdownMenuLabel>操作</DropdownMenuLabel>
                                <DropdownMenuItem onClick={onCopyId}>
                                    <Copy />
                                    カテゴリIDをコピー
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={onEdit}>
                                    <Pencil />
                                    編集
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={onAddChild}>
                                    <Plus />
                                    子のカテゴリを追加
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={!canDelete}
                                    onClick={onDelete}
                                    variant="destructive"
                                >
                                    <Trash2 />
                                    削除
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
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
    const startEdit = useSetAtom(startCategoryEditAtom);
    const startChild = useSetAtom(startCategoryChildAtom);
    // トーストを持たないので、コピー結果は読み上げ専用の領域だけで伝える。
    // 同じ文言でも読み上げ直すよう、連番を key にして要素ごと差し替える
    const [copyMessage, setCopyMessage] = useState({ seq: 0, text: "" });
    const announce = useCallback(
        (text: string) =>
            setCopyMessage((current) => ({ seq: current.seq + 1, text })),
        [],
    );
    const copyCategoryId = useCallback(
        (category: CategoryDto) => {
            // 安全なコンテキスト以外では navigator.clipboard 自体が存在しない
            if (!navigator.clipboard) {
                announce("カテゴリIDをコピーできませんでした");
                return;
            }
            void navigator.clipboard
                .writeText(category.id)
                .then(() =>
                    announce(`${category.name}のカテゴリIDをコピーしました`),
                )
                .catch(() => announce("カテゴリIDをコピーできませんでした"));
        },
        [announce],
    );
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
                splat: buildCategorySplat(categories, item.id),
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
                onCopyId: () => copyCategoryId(item),
                onEdit: () => startEdit(item),
                onAddChild: () => startChild(item),
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
    }, [
        categories,
        copyCategoryId,
        expanded,
        onDelete,
        query,
        setExpanded,
        startChild,
        startEdit,
    ]);
    const table = useTable({ columns, data, features });

    return (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b p-5">
                <h2 className="font-bold">登録済みカテゴリ</h2>
                <label className="relative" htmlFor="category-search">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <span className="sr-only">検索</span>
                    <Input
                        id="category-search"
                        className="pl-8"
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
            <div aria-live="polite" className="sr-only">
                <span key={copyMessage.seq}>{copyMessage.text}</span>
            </div>
        </section>
    );
}
