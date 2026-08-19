import {
    createColumnHelper,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { Copy, Ellipsis, Pencil, Trash2 } from "lucide-react";
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
import type { ItemDto } from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import { buildHierarchyLabels } from "@/lib/hierarchy";

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, ItemDto>();
type ItemTableProps = {
    items: ItemDto[];
    categories: CategoryDto[];
    locations: LocationDto[];
    deletingId: string | null;
    onEdit: (item: ItemDto) => void;
    onDelete: (item: ItemDto) => void;
};

export function ItemTable({
    items,
    categories,
    locations,
    deletingId,
    onEdit,
    onDelete,
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
    const categoryNames = useMemo(
        () => buildHierarchyLabels(categories),
        [categories],
    );
    const locationNames = useMemo(
        () => buildHierarchyLabels(locations),
        [locations],
    );
    const columns = useMemo(
        () =>
            columnHelper.columns([
                columnHelper.accessor("name", {
                    header: "品目名",
                    cell: ({ getValue }) => (
                        <span className="font-medium">{getValue()}</span>
                    ),
                }),
                columnHelper.display({
                    id: "category",
                    header: "カテゴリ",
                    cell: ({ row }) =>
                        categoryNames.get(row.original.categoryId) ?? "—",
                }),
                columnHelper.display({
                    id: "location",
                    header: "保管場所",
                    cell: ({ row }) =>
                        locationNames.get(row.original.locationId) ?? "—",
                }),
                columnHelper.accessor("baseUnit", {
                    header: "単位",
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
            categoryNames,
            copyItemId,
            deletingId,
            locationNames,
            onDelete,
            onEdit,
        ],
    );
    const table = useTable({ columns, data: items, features });

    return (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b p-5">
                <h2 className="font-bold">登録済み品目</h2>
                <p className="text-xs text-muted-foreground">
                    {items.length} 件
                </p>
            </div>
            <Table className="min-w-[720px]" aria-label="登録済み品目">
                <TableHeader className="bg-muted/50">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <TableHead
                                    className={
                                        header.id === "actions"
                                            ? "px-5 text-right"
                                            : "px-5"
                                    }
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
