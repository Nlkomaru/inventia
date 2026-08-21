import { Link } from "@tanstack/react-router";
import {
    createColumnHelper,
    createSortedRowModel,
    rowSortingFeature,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { ArrowUpDown, BookOpen, ChevronDown, Pencil } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { BookReadingItemDto } from "@/domain/item";
import type { ReadingStatus } from "@/domain/reading";
import { readingStatusLabels, toReadingDateInput } from "@/lib/reading-input";
import { cn } from "@/lib/utils";

const features = tableFeatures({
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
});

const columnHelper = createColumnHelper<typeof features, BookReadingItemDto>();

const columnLabels: Record<string, string> = {
    name: "書籍",
    readingStatus: "読書状態",
    startedAt: "開始日",
    finishedAt: "読了日",
};

// 未設定を末尾に置く。並べ替えでは読み始める順に並ぶ方が使いやすい
const readingStatusRank: Record<ReadingStatus, number> = {
    unread: 0,
    reading: 1,
    finished: 2,
};

const compareReadingStatus = (
    left: ReadingStatus | null,
    right: ReadingStatus | null,
): number =>
    (left === null ? 3 : readingStatusRank[left]) -
    (right === null ? 3 : readingStatusRank[right]);

// 日付なしは並べ替えの向きに関わらず末尾へ置く（最短期限の列と同じ扱い）
const compareDate = (left: string | null, right: string | null): number => {
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left < right ? -1 : 1;
};

const badgeClassName =
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold";

// 状態はラベルで伝わるため、色は補助に留める。
// primary 系は読書中だけに使い、視線が今読んでいる本へ向くようにする
const readingStatusClassName: Record<ReadingStatus, string> = {
    unread: "border-border bg-card text-foreground",
    reading: "border-primary/30 bg-primary/10 text-primary",
    finished: "border-border bg-muted text-muted-foreground",
};

function ReadingStatusCell({ status }: { status: ReadingStatus | null }) {
    if (status === null) {
        return <span className="text-sm text-muted-foreground">未設定</span>;
    }
    return (
        <span className={cn(badgeClassName, readingStatusClassName[status])}>
            <BookOpen aria-hidden="true" className="size-3.5" />
            {readingStatusLabels[status]}
        </span>
    );
}

/**
 * 読書の日付は UTC の暦日として保存されるため、表示も入力欄と同じ UTC で組む。
 * 表示だけ日本時間へ寄せると、入力欄の値と 1 日ずれて見えることがある。
 */
function ReadingDateCell({ value }: { value: string | null }) {
    const date = value === null ? "" : toReadingDateInput(value);
    return (
        <span className="whitespace-nowrap font-mono text-sm tabular-nums">
            {date === "" ? (
                <span className="font-sans text-muted-foreground">—</span>
            ) : (
                date
            )}
        </span>
    );
}

type BookTableProps = {
    books: BookReadingItemDto[];
    /** 絞り込み前の件数。空表示の文言を絞り込み由来かどうかで分ける。 */
    totalCount: number;
    onEdit: (book: BookReadingItemDto) => void;
};

export function BookTable({ books, totalCount, onEdit }: BookTableProps) {
    const columns = useMemo(
        () =>
            columnHelper.columns([
                columnHelper.accessor("name", {
                    header: columnLabels.name,
                    sortFn: (rowA, rowB) =>
                        rowA.original.name.localeCompare(
                            rowB.original.name,
                            "ja",
                        ),
                    cell: ({ getValue, row }) => (
                        <Link
                            className="font-medium underline-offset-4 hover:underline"
                            params={{ itemId: row.original.id }}
                            to="/inventory/items/$itemId"
                        >
                            {getValue()}
                        </Link>
                    ),
                }),
                columnHelper.accessor("readingStatus", {
                    header: columnLabels.readingStatus,
                    sortFn: (rowA, rowB) =>
                        compareReadingStatus(
                            rowA.original.readingStatus,
                            rowB.original.readingStatus,
                        ),
                    cell: ({ getValue }) => (
                        <ReadingStatusCell status={getValue()} />
                    ),
                }),
                // 日付は readingState の中にあるため accessor 関数で取り出す。
                // display 列は値を持たず並べ替えの対象にできない
                columnHelper.accessor(
                    (row) => row.readingState?.startedAt ?? null,
                    {
                        id: "startedAt",
                        header: columnLabels.startedAt,
                        sortFn: (rowA, rowB) =>
                            compareDate(
                                rowA.original.readingState?.startedAt ?? null,
                                rowB.original.readingState?.startedAt ?? null,
                            ),
                        cell: ({ getValue }) => (
                            <ReadingDateCell value={getValue()} />
                        ),
                    },
                ),
                columnHelper.accessor(
                    (row) => row.readingState?.finishedAt ?? null,
                    {
                        id: "finishedAt",
                        header: columnLabels.finishedAt,
                        sortFn: (rowA, rowB) =>
                            compareDate(
                                rowA.original.readingState?.finishedAt ?? null,
                                rowB.original.readingState?.finishedAt ?? null,
                            ),
                        cell: ({ getValue }) => (
                            <ReadingDateCell value={getValue()} />
                        ),
                    },
                ),
                columnHelper.display({
                    id: "actions",
                    header: "操作",
                    enableSorting: false,
                    cell: ({ row }) => (
                        <div className="flex justify-end">
                            <Button
                                aria-label={`${row.original.name}の読書状態を編集`}
                                onClick={() => onEdit(row.original)}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                <Pencil data-icon="inline-start" />
                                読書状態
                            </Button>
                        </div>
                    ),
                }),
            ]),
        [onEdit],
    );
    const table = useTable({
        columns,
        data: books,
        enableSortingRemoval: false,
        features,
    });
    const rows = table.getRowModel().rows;

    return (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b p-5">
                <h2 className="font-bold">書籍カテゴリの品目</h2>
                <p className="text-xs text-muted-foreground">
                    {books.length} 件
                </p>
            </div>
            <Table aria-label="書籍一覧" className="min-w-[720px]">
                <TableHeader className="bg-muted/50">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => {
                                const sortDirection =
                                    header.column.getIsSorted();
                                const label =
                                    columnLabels[header.column.id] ??
                                    header.column.id;

                                return (
                                    <TableHead
                                        aria-sort={
                                            sortDirection === "asc"
                                                ? "ascending"
                                                : sortDirection === "desc"
                                                  ? "descending"
                                                  : "none"
                                        }
                                        className={cn(
                                            "px-5",
                                            header.column.id === "actions" &&
                                                "text-right",
                                        )}
                                        key={header.id}
                                        scope="col"
                                    >
                                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                                            <Button
                                                aria-label={`${label}で並べ替え`}
                                                // 見出しの文字色は TableHead の text-foreground を保つ
                                                className="-mx-2.5 font-medium"
                                                onClick={header.column.getToggleSortingHandler()}
                                                size="sm"
                                                type="button"
                                                variant="ghost"
                                            >
                                                {table.FlexRender({ header })}
                                                {sortDirection ? (
                                                    <ChevronDown
                                                        aria-hidden="true"
                                                        className={cn(
                                                            "transition-transform",
                                                            sortDirection ===
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
                    {rows.length > 0 ? (
                        rows.map((row) => (
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
                                className="h-28 text-center text-muted-foreground"
                                colSpan={columns.length}
                            >
                                {totalCount === 0
                                    ? "書籍カテゴリの品目がまだありません"
                                    : "該当する書籍がありません"}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </section>
    );
}
