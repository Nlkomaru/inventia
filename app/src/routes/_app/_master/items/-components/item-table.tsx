import {
    createColumnHelper,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
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
import { formatDisplayDateTime } from "@/lib/datetime";
import { readingStatusLabels } from "../-functions/reading-state-form";
import { getHierarchyLabels } from "./item-options";

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, ItemDto>();
const formatExpiry = (value: string | null): string =>
    (value === null ? null : formatDisplayDateTime(value)) ?? "—";

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
    const categoryNames = useMemo(
        () => getHierarchyLabels(categories),
        [categories],
    );
    const locationNames = useMemo(
        () => getHierarchyLabels(locations),
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
                columnHelper.accessor("currentQuantity", {
                    header: "現在庫",
                    cell: ({ row, getValue }) => {
                        const threshold = row.original.lowStockThreshold;
                        const low =
                            threshold !== null && getValue() <= threshold;
                        return (
                            <span
                                className={
                                    low
                                        ? "font-semibold text-destructive"
                                        : undefined
                                }
                            >
                                {getValue()}
                            </span>
                        );
                    },
                }),
                columnHelper.accessor("earliestExpiryDate", {
                    header: "最短期限",
                    cell: ({ getValue, row }) => (
                        <span className="whitespace-nowrap">
                            {formatExpiry(getValue())}
                            {row.original.lotCount > 1 ? (
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                    （{row.original.lotCount} ロット）
                                </span>
                            ) : null}
                        </span>
                    ),
                }),
                columnHelper.accessor("readingStatus", {
                    header: "読書状態",
                    // 書籍カテゴリ以外と未設定はどちらも値を持たない
                    cell: ({ getValue }) => {
                        const status = getValue();
                        return status === null ? (
                            <span className="text-muted-foreground">—</span>
                        ) : (
                            <span className="whitespace-nowrap">
                                {readingStatusLabels[status]}
                            </span>
                        );
                    },
                }),
                columnHelper.display({
                    id: "actions",
                    header: "操作",
                    cell: ({ row }) => (
                        <div className="flex justify-end gap-1">
                            <Button
                                aria-label={`${row.original.name}を編集`}
                                onClick={() => onEdit(row.original)}
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                            >
                                <Pencil data-icon="inline-start" />
                            </Button>
                            <Button
                                aria-label={`${row.original.name}を削除`}
                                disabled={deletingId === row.original.id}
                                onClick={() => onDelete(row.original)}
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                            >
                                <Trash2 data-icon="inline-start" />
                            </Button>
                        </div>
                    ),
                }),
            ]),
        [categoryNames, deletingId, locationNames, onDelete, onEdit],
    );
    const table = useTable({ columns, data: items, features });

    return (
        <Card>
            <CardHeader>
                <CardTitle>登録済み品目</CardTitle>
                <CardDescription>{`${items.length} 件`}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                <Table className="min-w-[980px]" aria-label="登録済み品目">
                    <TableHeader className="bg-muted/50">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <TableHead
                                        className={
                                            header.id === "actions"
                                                ? "text-right"
                                                : undefined
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
                                        <TableCell key={cell.id}>
                                            {table.FlexRender({ cell })}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    className="h-28 text-center text-muted-foreground"
                                    colSpan={columns.length}
                                >
                                    品目が登録されていません
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
