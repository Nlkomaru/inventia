import {
    createColumnHelper,
    createSortedRowModel,
    rowSortingFeature,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import {
    ArrowUpDown,
    BookOpen,
    ChevronDown,
    Clock,
    MapPin,
    TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { ItemDto } from "@/domain/item";
import { type ItemLotDto, sortLotsFefo } from "@/domain/lot";
import type { ReadingStatus } from "@/domain/reading";
import { formatDisplayDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const features = tableFeatures({
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
});

const columnHelper = createColumnHelper<typeof features, ItemDto>();

const dayInMs = 86_400_000;
const defaultSoonWithinDays = 7;
// 内訳は先頭 2 件までを列挙し、残りは件数だけを示す
const visibleLotLines = 2;
const loadingRowKeys = ["loading-0", "loading-1", "loading-2", "loading-3"];

const columnLabels: Record<string, string> = {
    name: "品目",
    location: "保管場所",
    currentQuantity: "現在庫（合計）",
    earliestExpiryDate: "最短期限",
    lots: "ロット内訳",
    readingStatus: "読書状態",
};

/**
 * 読書状態の表示ラベル。一覧の絞り込みでも同じ文言を使う。
 * 品目マスタ側は route 配下に同じ対応を持つ（共有コンポーネントは route 配下を参照しない）。
 */
export const readingStatusLabels: Record<ReadingStatus, string> = {
    unread: "未読",
    reading: "読書中",
    finished: "読了",
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

export type ExpiryState = "expired" | "soon" | "scheduled" | "none";

type ExpirySignal = {
    state: ExpiryState;
    /** 状態を色以外の手段でも伝えるための短いラベル。 */
    label: string;
    date: string | null;
};

const formatDate = (value: string): string => formatDisplayDate(value) ?? "—";

const formatQuantity = (quantity: number, unit: string): string =>
    `${quantity.toLocaleString("ja-JP")} ${unit}`;

/**
 * 期限の状態を判定する。`now` は 1 回の描画で共通の基準時刻を使う。
 * 一覧側の期限フィルターも同じ判定を共有する。
 */
export const resolveExpirySignal = (
    expiryDate: string | null,
    now: number,
    soonWithinDays: number,
): ExpirySignal => {
    if (expiryDate === null) {
        return { state: "none", label: "期限なし", date: null };
    }
    const time = new Date(expiryDate).getTime();
    if (Number.isNaN(time)) {
        return { state: "none", label: "期限なし", date: null };
    }
    const date = formatDate(expiryDate);
    if (time <= now) {
        return { state: "expired", label: "期限切れ", date };
    }
    const daysLeft = Math.ceil((time - now) / dayInMs);
    if (daysLeft <= soonWithinDays) {
        return { state: "soon", label: `あと ${daysLeft} 日`, date };
    }
    return { state: "scheduled", label: date, date };
};

// 期限なしは昇順で最後に置く。降順では先頭へ回るが、期限の近い在庫を
// 探す用途では昇順が主で、null を値として比較するより順序が読みやすい
const compareExpiry = (left: string | null, right: string | null): number => {
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left < right ? -1 : 1;
};

const badgeClassName =
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold";

function ExpiryCell({ signal }: { signal: ExpirySignal }) {
    // 期限なし・余裕のある期限はバッジを付けず、静かな表示にとどめる
    if (signal.state === "none" || signal.state === "scheduled") {
        return (
            <span className="whitespace-nowrap text-sm text-muted-foreground">
                {signal.label}
            </span>
        );
    }
    const expired = signal.state === "expired";
    const Icon = expired ? TriangleAlert : Clock;
    return (
        <span className="flex flex-col items-start gap-1">
            <span
                className={cn(
                    badgeClassName,
                    // destructive の文字色は薄い赤地に載せると 4.5:1 を下回るため、
                    // 期限切れバッジは地色を card のままにして枠線で示す
                    expired
                        ? "border-destructive/40 bg-card text-destructive"
                        : "border-primary/30 bg-primary/10 text-primary",
                )}
            >
                <Icon aria-hidden="true" className="size-3.5" />
                {signal.label}
            </span>
            {signal.date ? (
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {signal.date}
                </span>
            ) : null}
        </span>
    );
}

// 状態はラベルで伝わるため、色は補助に留める。
// primary 系は読書中だけに使い、視線が今読んでいる本へ向くようにする
const readingStatusClassName: Record<ReadingStatus, string> = {
    unread: "border-border bg-card text-foreground",
    reading: "border-primary/30 bg-primary/10 text-primary",
    finished: "border-border bg-muted text-muted-foreground",
};

function ReadingStatusCell({ status }: { status: ReadingStatus | null }) {
    // 書籍カテゴリー以外と未設定はどちらも値を持たない
    if (status === null) {
        return <span className="text-sm text-muted-foreground">—</span>;
    }
    return (
        <span className={cn(badgeClassName, readingStatusClassName[status])}>
            <BookOpen aria-hidden="true" className="size-3.5" />
            {readingStatusLabels[status]}
        </span>
    );
}

type LotLine = {
    key: string;
    quantity: number;
    expiryDate: string | null;
};

/**
 * 内訳として表示する行を決める。
 * `lotCount <= 1` の品目は合計と最短期限で内訳が尽きているため行を作らない。
 * `lotCount >= 2` でロットを取得できていない場合は null を返し、件数だけを示す。
 */
const resolveLotLines = (
    item: ItemDto,
    lots: readonly ItemLotDto[] | undefined,
): LotLine[] | null => {
    if (item.lotCount <= 1) {
        return [];
    }
    if (lots === undefined) {
        return null;
    }
    return sortLotsFefo(lots)
        .filter((lot) => lot.quantity > 0)
        .map((lot) => ({
            key: lot.id,
            quantity: lot.quantity,
            expiryDate: lot.expiryDate,
        }));
};

function LotBreakdownCell({
    item,
    lines,
    now,
    soonWithinDays,
}: {
    item: ItemDto;
    lines: LotLine[] | null;
    now: number;
    soonWithinDays: number;
}) {
    if (lines === null) {
        return (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
                全 {item.lotCount} ロット
            </span>
        );
    }
    if (lines.length === 0) {
        return <span className="text-sm text-muted-foreground">—</span>;
    }
    const visible = lines.slice(0, visibleLotLines);
    const rest = lines.length - visible.length;
    return (
        <ul className="flex flex-col gap-0.5">
            {visible.map((line) => {
                const signal = resolveExpirySignal(
                    line.expiryDate,
                    now,
                    soonWithinDays,
                );
                return (
                    <li
                        className="flex items-baseline gap-1.5 whitespace-nowrap text-xs"
                        key={line.key}
                    >
                        <span className="font-mono font-medium tabular-nums">
                            {formatQuantity(line.quantity, item.baseUnit)}
                        </span>
                        <span
                            className={cn(
                                "text-muted-foreground",
                                signal.state === "expired" &&
                                    "font-semibold text-destructive",
                            )}
                        >
                            / {signal.date ?? "期限なし"}
                        </span>
                    </li>
                );
            })}
            {rest > 0 ? (
                <li className="whitespace-nowrap text-xs text-muted-foreground">
                    +{rest} 件
                </li>
            ) : null}
        </ul>
    );
}

export type InventoryTableProps = {
    items: ItemDto[];
    /**
     * ロットが 2 件以上ある品目の内訳。取得済みの品目だけを渡す。
     * 未取得の品目は件数のみの表示へ退避する。
     */
    lotsByItemId?: ReadonlyMap<string, readonly ItemLotDto[]>;
    categoryLabels?: ReadonlyMap<string, string>;
    locationLabels?: ReadonlyMap<string, string>;
    loading?: boolean;
    soonWithinDays?: number;
};

export function InventoryTable({
    items,
    lotsByItemId,
    categoryLabels,
    locationLabels,
    loading = false,
    soonWithinDays = defaultSoonWithinDays,
}: InventoryTableProps) {
    // 期限判定の基準時刻。行ごとに Date.now() を読むと同一描画内で基準が
    // ずれるため、マウント時に 1 回だけ求める
    const now = useMemo(() => Date.now(), []);
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
                        <div className="min-w-48 max-w-72">
                            <p className="font-semibold break-words">
                                {getValue()}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {categoryLabels?.get(row.original.categoryId) ??
                                    "—"}
                            </p>
                        </div>
                    ),
                }),
                columnHelper.display({
                    id: "location",
                    header: columnLabels.location,
                    enableSorting: false,
                    cell: ({ row }) => (
                        <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
                            <MapPin aria-hidden="true" className="size-4" />
                            {locationLabels?.get(row.original.locationId) ??
                                "—"}
                        </span>
                    ),
                }),
                columnHelper.accessor("currentQuantity", {
                    header: columnLabels.currentQuantity,
                    sortFn: (rowA, rowB) =>
                        rowA.original.currentQuantity -
                        rowB.original.currentQuantity,
                    cell: ({ getValue, row }) => {
                        const quantity = getValue();
                        const threshold = row.original.lowStockThreshold;
                        const low =
                            quantity === 0 ||
                            (threshold !== null && quantity <= threshold);
                        return (
                            <div className="text-right">
                                <p
                                    className={cn(
                                        "whitespace-nowrap font-mono text-sm font-semibold tabular-nums",
                                        quantity === 0 && "text-destructive",
                                    )}
                                >
                                    {formatQuantity(
                                        quantity,
                                        row.original.baseUnit,
                                    )}
                                </p>
                                {low ? (
                                    <p className="mt-0.5 whitespace-nowrap text-xs font-semibold text-destructive">
                                        {quantity === 0
                                            ? "在庫切れ"
                                            : "残りわずか"}
                                    </p>
                                ) : null}
                            </div>
                        );
                    },
                }),
                columnHelper.accessor("earliestExpiryDate", {
                    header: columnLabels.earliestExpiryDate,
                    sortFn: (rowA, rowB) =>
                        compareExpiry(
                            rowA.original.earliestExpiryDate,
                            rowB.original.earliestExpiryDate,
                        ),
                    cell: ({ getValue }) => (
                        <ExpiryCell
                            signal={resolveExpirySignal(
                                getValue(),
                                now,
                                soonWithinDays,
                            )}
                        />
                    ),
                }),
                columnHelper.display({
                    id: "lots",
                    header: columnLabels.lots,
                    enableSorting: false,
                    cell: ({ row }) => (
                        <LotBreakdownCell
                            item={row.original}
                            lines={resolveLotLines(
                                row.original,
                                lotsByItemId?.get(row.original.id),
                            )}
                            now={now}
                            soonWithinDays={soonWithinDays}
                        />
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
            ]),
        [categoryLabels, locationLabels, lotsByItemId, now, soonWithinDays],
    );
    const table = useTable({
        columns,
        data: items,
        enableSortingRemoval: false,
        features,
    });
    const rows = table.getRowModel().rows;

    return (
        <Card>
            <CardHeader>
                <CardTitle>品目と期限別ロット</CardTitle>
                <CardDescription>
                    {loading
                        ? "在庫を読み込み中…"
                        : `${items.length} 件の品目。数量は期限別ロットの合計です。`}
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                <Table
                    aria-busy={loading}
                    aria-label="在庫一覧"
                    className="min-w-[980px]"
                >
                    <TableHeader className="bg-muted/50">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => {
                                    const sortDirection =
                                        header.column.getIsSorted();
                                    const label =
                                        columnLabels[header.column.id] ??
                                        header.column.id;
                                    const numeric =
                                        header.column.id === "currentQuantity";

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
                                                numeric && "text-right",
                                            )}
                                            key={header.id}
                                            scope="col"
                                        >
                                            {header.isPlaceholder ? null : header.column.getCanSort() ? (
                                                <Button
                                                    aria-label={`${label}で並べ替え`}
                                                    className={cn(
                                                        // 見出しの文字色は TableHead の text-foreground を保つ。
                                                        // muted へ落とすとヘッダー背景との比が 4.5:1 を下回る
                                                        "-mx-2.5 font-medium",
                                                        numeric && "ml-auto",
                                                    )}
                                                    onClick={header.column.getToggleSortingHandler()}
                                                    size="sm"
                                                    type="button"
                                                    variant="ghost"
                                                >
                                                    {table.FlexRender({
                                                        header,
                                                    })}
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
                        {loading ? (
                            loadingRowKeys.map((rowKey) => (
                                <TableRow key={rowKey}>
                                    {columns.map((column) => (
                                        <TableCell key={column.id}>
                                            <Skeleton className="h-4 w-24" />
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : rows.length > 0 ? (
                            rows.map((row) => (
                                <TableRow key={row.id}>
                                    {row.getAllCells().map((cell) => (
                                        <TableCell
                                            className="align-top"
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
                                    該当する品目がありません
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
