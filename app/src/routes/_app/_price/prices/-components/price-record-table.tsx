import { Link } from "@tanstack/react-router";
import {
    createColumnHelper,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    type AllPriceRecordDto,
    priceComparisonBasis,
    priceComparisonUnit,
} from "@/domain/price";
import { formatDisplayMonthDayTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, AllPriceRecordDto>();

// 金額の列は見出しと本文の両方を右へ寄せる
const numericColumnIds = new Set(["price", "unitPrice"]);

/** 内容量は 1 個あたり × 個数で示し、包装があれば併記する。 */
const formatContent = (record: AllPriceRecordDto): string => {
    const amount = `${record.contentAmount.toLocaleString("ja-JP")} × ${record.setCount} ${record.baseUnit}`;
    return record.packaging === null
        ? amount
        : `${amount}（${record.packaging}）`;
};

const formatPrice = (price: number): string =>
    `¥${price.toLocaleString("ja-JP")}`;

// 単価は 100 g / 100 mL あたりの値なので、kg や L を基準単位にした品目でも
// 比較単位そのものを表示する
const formatUnitPrice = (record: AllPriceRecordDto): string =>
    `${record.unitPrice.toFixed(2)} 円 / ${priceComparisonBasis(record.baseDimension)} ${priceComparisonUnit(record.baseDimension, record.baseUnit)}`;

const columns = columnHelper.columns([
    columnHelper.accessor((row) => row.recordedAt, {
        id: "recordedAt",
        header: "日時",
        cell: ({ row }) => (
            <span className="whitespace-nowrap tabular-nums">
                {formatDisplayMonthDayTime(row.original.recordedAt) ??
                    row.original.recordedAt}
            </span>
        ),
    }),
    columnHelper.accessor((row) => row.itemName, {
        id: "itemName",
        header: "品物",
        cell: ({ row }) => (
            <Link
                className="flex items-center gap-2 underline-offset-4 hover:underline"
                params={{ itemId: row.original.itemId }}
                to="/inventory/items/$itemId"
            >
                {/* 絵文字は品目名の飾りなので読み上げから外す */}
                <span aria-hidden="true">{row.original.itemEmoji}</span>
                <span>{row.original.itemName}</span>
            </Link>
        ),
    }),
    columnHelper.accessor((row) => row.storeName ?? row.source, {
        id: "store",
        header: "Store",
        cell: ({ row }) => (
            <span className="flex items-center gap-2 whitespace-nowrap">
                {row.original.storeFaviconUrl === null ? null : (
                    <img
                        alt=""
                        className="size-4 shrink-0 rounded-sm object-contain"
                        src={row.original.storeFaviconUrl}
                    />
                )}
                {/* 店舗マスタを持たない古い行は自由記述の source をそのまま出す */}
                <span>{row.original.storeName ?? row.original.source}</span>
            </span>
        ),
    }),
    columnHelper.accessor((row) => row.contentAmount, {
        id: "content",
        header: "内容量",
        cell: ({ row }) => (
            <span className="whitespace-nowrap">
                {formatContent(row.original)}
            </span>
        ),
    }),
    columnHelper.accessor((row) => row.price, {
        id: "price",
        header: "価格",
        cell: ({ row }) => (
            <div className="text-right">
                <span className="whitespace-nowrap font-mono tabular-nums">
                    {formatPrice(row.original.price)}
                </span>
            </div>
        ),
    }),
    columnHelper.accessor((row) => row.unitPrice, {
        id: "unitPrice",
        header: "単価",
        cell: ({ row }) => (
            <div className="text-right">
                <span className="whitespace-nowrap font-mono tabular-nums">
                    {formatUnitPrice(row.original)}
                </span>
            </div>
        ),
    }),
]);

export function PriceRecordTable({
    records,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
}: {
    records: AllPriceRecordDto[];
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    onLoadMore: () => void;
}) {
    const table = useTable({ columns, data: records, features });

    return (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b p-5">
                <h2 className="font-bold">記録した価格</h2>
                <p className="text-xs text-muted-foreground">
                    記録日時の新しい順に表示します。
                </p>
            </div>
            <Table aria-label="価格一覧" className="min-w-[840px]">
                <TableHeader className="bg-muted/50">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <TableHead
                                    className={cn(
                                        "px-5",
                                        numericColumnIds.has(
                                            header.column.id,
                                        ) && "text-right",
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
                            <TableRow key={row.id}>
                                {row.getAllCells().map((cell) => (
                                    <TableCell
                                        className="px-5 py-3 align-top"
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
                                価格の記録がありません。レシートを反映するか品目の画面で記録すると表示されます。
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t p-5">
                <p aria-live="polite" className="text-sm text-muted-foreground">
                    {records.length} 件を表示中
                    {hasNextPage ? "" : "（すべて表示）"}
                </p>
                <Button
                    disabled={!hasNextPage || isFetchingNextPage}
                    onClick={onLoadMore}
                    type="button"
                    variant="outline"
                >
                    {isFetchingNextPage ? "読み込み中…" : "続きを読み込む"}
                </Button>
            </div>
        </section>
    );
}
