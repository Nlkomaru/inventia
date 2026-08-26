import { Link } from "@tanstack/react-router";
import {
    createColumnHelper,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import {
    ArrowUpDown,
    ChevronDown,
    Copy,
    Ellipsis,
    Pencil,
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { CategoryDto } from "@/domain/category";
import type { ItemDto, ItemListSort, ItemSortDirection } from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import { buildAncestrySplat } from "@/lib/hierarchy";
import { cn } from "@/lib/utils";

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, ItemDto>();

type ItemMasterSort = Exclude<ItemListSort, "expiry">;

const sortableColumns: Record<ItemMasterSort, true> = {
    name: true,
    category: true,
    location: true,
    baseUnit: true,
};

const isItemMasterSort = (columnId: string): columnId is ItemMasterSort =>
    Object.hasOwn(sortableColumns, columnId);

const columnLabels: Record<string, string> = {
    name: "品目名",
    category: "カテゴリ",
    location: "保管場所",
    baseUnit: "単位",
    inventory: "在庫",
    actions: "操作",
};
type ItemTableProps = {
    items: ItemDto[];
    categories: CategoryDto[];
    locations: LocationDto[];
    deletingId: string | null;
    sort: ItemMasterSort | null;
    sortDirection: ItemSortDirection;
    onEdit: (item: ItemDto) => void;
    onDelete: (item: ItemDto) => void;
    onSortChange: (
        sort: ItemMasterSort | null,
        sortDirection: ItemSortDirection,
    ) => void;
};

export function ItemTable({
    items,
    categories,
    locations,
    deletingId,
    onEdit,
    onDelete,
    sort,
    sortDirection,
    onSortChange,
}: ItemTableProps) {
    // トーストを持たないので、コピー結果は読み上げ専用の領域だけで伝える。
    // 同じ文言でも読み上げ直すよう、連番を key にして要素ごと差し替える
    const [copyMessage, setCopyMessage] = useState({ seq: 0, text: "" });
    const announce = useCallback(
        (text: string) =>
            setCopyMessage((current) => ({ seq: current.seq + 1, text })),
        [],
    );
    const copyItemId = useCallback(
        (item: ItemDto) => {
            // 安全なコンテキスト以外では navigator.clipboard 自体が存在しない
            if (!navigator.clipboard) {
                announce("品目IDをコピーできませんでした");
                return;
            }
            void navigator.clipboard
                .writeText(item.id)
                .then(() => announce(`${item.name}の品目IDをコピーしました`))
                .catch(() => announce("品目IDをコピーできませんでした"));
        },
        [announce],
    );
    // 表では末端の名前だけを出す。祖先まで並べると行が読みにくくなるため、
    // 階層はリンク先のカテゴリ・保管場所のページで辿ってもらう
    const categoryById = useMemo(
        () => new Map(categories.map((category) => [category.id, category])),
        [categories],
    );
    const locationById = useMemo(
        () => new Map(locations.map((location) => [location.id, location])),
        [locations],
    );
    const columns = useMemo(
        () =>
            columnHelper.columns([
                columnHelper.accessor("name", {
                    header: columnLabels.name,
                    // 品目名からはマスタの品目ページへ入る。単位や次元の
                    // つけ替えなど、この一覧が扱う登録内容の変更先に揃える
                    cell: ({ getValue, row }) => (
                        <Link
                            className="font-medium underline-offset-4 hover:underline"
                            params={{ itemId: row.original.id }}
                            to="/items/$itemId"
                        >
                            {getValue()}
                        </Link>
                    ),
                }),
                columnHelper.display({
                    id: "category",
                    header: columnLabels.category,
                    cell: ({ row }) => {
                        const category = categoryById.get(
                            row.original.categoryId,
                        );
                        if (!category) return "—";
                        return (
                            <Link
                                className="underline-offset-4 hover:underline"
                                params={{
                                    _splat: buildAncestrySplat(
                                        categories,
                                        category.id,
                                    ),
                                }}
                                to="/categories/$"
                            >
                                {category.name}
                            </Link>
                        );
                    },
                }),
                columnHelper.display({
                    id: "location",
                    header: columnLabels.location,
                    cell: ({ row }) => {
                        const location = locationById.get(
                            row.original.locationId,
                        );
                        if (!location) return "—";
                        return (
                            <Link
                                className="underline-offset-4 hover:underline"
                                params={{
                                    _splat: buildAncestrySplat(
                                        locations,
                                        location.id,
                                    ),
                                }}
                                to="/locations/$"
                            >
                                {location.name}
                            </Link>
                        );
                    },
                }),
                columnHelper.accessor("baseUnit", {
                    header: columnLabels.baseUnit,
                }),
                // 品目名のリンク先をマスタへ移した分、在庫・価格・履歴への
                // 導線をこの列で残す
                columnHelper.display({
                    id: "inventory",
                    header: "在庫",
                    cell: ({ row }) => (
                        <Link
                            aria-label={`${row.original.name}の在庫詳細`}
                            className="text-sm underline-offset-4 hover:underline"
                            params={{ itemId: row.original.id }}
                            to="/inventory/items/$itemId"
                        >
                            在庫詳細
                        </Link>
                    ),
                }),
                columnHelper.display({
                    id: "actions",
                    header: "操作",
                    cell: ({ row }) => (
                        <div className="flex justify-end">
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    render={
                                        <Button
                                            aria-label={`${row.original.name}の操作`}
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
                                        <DropdownMenuLabel>
                                            操作
                                        </DropdownMenuLabel>
                                        <DropdownMenuItem
                                            onClick={() =>
                                                copyItemId(row.original)
                                            }
                                        >
                                            <Copy />
                                            品目IDをコピー
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => onEdit(row.original)}
                                        >
                                            <Pencil />
                                            編集
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            disabled={
                                                deletingId === row.original.id
                                            }
                                            onClick={() =>
                                                onDelete(row.original)
                                            }
                                            variant="destructive"
                                        >
                                            <Trash2 />
                                            削除
                                        </DropdownMenuItem>
                                    </DropdownMenuGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    ),
                }),
            ]),
        [
            categories,
            categoryById,
            copyItemId,
            deletingId,
            locationById,
            locations,
            onDelete,
            onEdit,
        ],
    );
    const table = useTable({ columns, data: items, features });

    return (
        <section className="overflow-hidden rounded-2xl border">
            <Table className="min-w-[720px]" aria-label="登録済み品目">
                <TableHeader className="bg-muted/50">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => {
                                const label =
                                    columnLabels[header.column.id] ??
                                    header.column.id;
                                const sortableColumn = isItemMasterSort(
                                    header.column.id,
                                )
                                    ? header.column.id
                                    : null;
                                const activeSortDirection =
                                    sortableColumn !== null &&
                                    sort === sortableColumn
                                        ? sortDirection
                                        : null;

                                return (
                                    <TableHead
                                        aria-sort={
                                            activeSortDirection === "asc"
                                                ? "ascending"
                                                : activeSortDirection === "desc"
                                                  ? "descending"
                                                  : "none"
                                        }
                                        className={cn(
                                            "px-5",
                                            header.id === "actions" &&
                                                "text-right",
                                        )}
                                        key={header.id}
                                        scope="col"
                                    >
                                        {header.isPlaceholder ? null : sortableColumn ? (
                                            <Button
                                                aria-label={`${label}で並べ替え`}
                                                className="-mx-2.5 font-medium"
                                                onClick={() =>
                                                    onSortChange(
                                                        activeSortDirection ===
                                                            "asc"
                                                            ? null
                                                            : sortableColumn,
                                                        activeSortDirection ===
                                                            "desc"
                                                            ? "asc"
                                                            : "desc",
                                                    )
                                                }
                                                size="sm"
                                                type="button"
                                                variant="ghost"
                                            >
                                                {table.FlexRender({ header })}
                                                {activeSortDirection ? (
                                                    <ChevronDown
                                                        aria-hidden="true"
                                                        className={cn(
                                                            "transition-transform",
                                                            activeSortDirection ===
                                                                "asc" &&
                                                                "rotate-180",
                                                        )}
                                                        data-icon="inline-end"
                                                    />
                                                ) : (
                                                    <ArrowUpDown
                                                        aria-hidden="true"
                                                        className="opacity-50"
                                                        data-icon="inline-end"
                                                    />
                                                )}
                                            </Button>
                                        ) : (
                                            table.FlexRender({ header })
                                        )}
                                    </TableHead>
                                );
                            })}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {table.getRowModel().rows.length > 0 ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow key={row.id}>
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
                                品目が登録されていません
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
