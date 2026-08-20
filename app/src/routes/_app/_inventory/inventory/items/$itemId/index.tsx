import {
    useSuspenseInfiniteQuery,
    useSuspenseQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    Link,
    useRouter,
} from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
    readingStatusLabels,
    resolveExpirySignal,
} from "@/components/InventoryTable";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
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
import type { ItemDetailDto } from "@/domain/item";
import { sortLotsFefo } from "@/domain/lot";
import {
    type PriceRecordDto,
    priceComparisonBasis,
    priceComparisonUnit,
} from "@/domain/price";
import type { StockMovementReason } from "@/domain/stock";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
    categoryDetailQueryOptions,
    itemDetailQueryOptions,
    itemPriceRecordsQueryOptions,
    itemStockHistoryQueryOptions,
    locationDetailQueryOptions,
} from "./-api/item-detail-queries";
import { ItemLotExpiryForm } from "./-components/item-lot-expiry-form";
import { ItemPriceForm } from "./-components/item-price-form";
import { ItemReceiveForm } from "./-components/item-receive-form";

// 期限が近いと見なす日数。在庫一覧の色分けと同じ値を使う
const soonWithinDays = 7;

// 幅は他の画面と揃える。ここだけ狭いと一覧から入ったときに幅が変わって見える
const pageClassName =
    "mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8";

const dimensionLabels: Record<ItemDetailDto["baseDimension"], string> = {
    mass: "重量",
    volume: "体積",
    count: "個数",
};

// 履歴一覧の画面と同じ文言。ルート配下の表示はルートごとに閉じる
const reasonLabels: Record<StockMovementReason, string> = {
    purchase: "購入",
    stocktake: "棚卸",
    consume: "消費",
    discard: "廃棄",
    other: "その他",
};

export const Route = createFileRoute(
    "/_app/_inventory/inventory/items/$itemId/",
)({
    // カテゴリと保管場所は品目を読めてから引く。品目が無い場合は
    // service の 404 をそのまま errorComponent へ渡す
    loader: async ({ context, params }) => {
        const item = await context.queryClient.ensureQueryData(
            itemDetailQueryOptions(params.itemId),
        );
        await Promise.all([
            context.queryClient.ensureQueryData(
                categoryDetailQueryOptions(item.categoryId),
            ),
            context.queryClient.ensureQueryData(
                locationDetailQueryOptions(item.locationId),
            ),
            context.queryClient.ensureInfiniteQueryData(
                itemStockHistoryQueryOptions(params.itemId),
            ),
            context.queryClient.ensureInfiniteQueryData(
                itemPriceRecordsQueryOptions(params.itemId),
            ),
        ]);
    },
    staticData: {
        // パンくずは静的なため品目名は入れず、見出しで示す
        breadcrumbs: [{ label: "品目" }],
    },
    component: ItemDetailPage,
    pendingComponent: ItemDetailPending,
    errorComponent: ItemDetailError,
});

function ItemDetailPage() {
    const { itemId } = Route.useParams();
    const { data: item } = useSuspenseQuery(itemDetailQueryOptions(itemId));
    const { data: category } = useSuspenseQuery(
        categoryDetailQueryOptions(item.categoryId),
    );
    const { data: location } = useSuspenseQuery(
        locationDetailQueryOptions(item.locationId),
    );
    const historyQuery = useSuspenseInfiniteQuery(
        itemStockHistoryQueryOptions(itemId),
    );
    const movements = useMemo(
        () => historyQuery.data.pages.flatMap((page) => page.movements),
        [historyQuery.data],
    );
    const priceQuery = useSuspenseInfiniteQuery(
        itemPriceRecordsQueryOptions(itemId),
    );
    const priceRecords = useMemo(
        () => priceQuery.data.pages.flatMap((page) => page.items),
        [priceQuery.data],
    );
    // 期限を編集中のロット。1 度に 1 行だけ開く
    const [editingLotId, setEditingLotId] = useState<string | null>(null);
    // 期限判定の基準時刻。1 回の描画で共通の基準を使う
    const now = useMemo(() => Date.now(), []);
    const lots = useMemo(() => sortLotsFefo(item.lots), [item.lots]);
    const historyError = historyQuery.error
        ? errorMessage(historyQuery.error, "在庫履歴を読み込めませんでした")
        : null;
    const priceError = priceQuery.error
        ? errorMessage(priceQuery.error, "価格を読み込めませんでした")
        : null;
    const lowStock =
        item.currentQuantity === 0 ||
        (item.lowStockThreshold !== null &&
            item.currentQuantity <= item.lowStockThreshold);

    return (
        <main className={pageClassName}>
            <header>
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Inventory
                </p>
                <h1 className="mt-1 text-2xl font-bold break-words">
                    {item.name}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    {category.name} / {location.name}
                </p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle>品目の情報</CardTitle>
                </CardHeader>
                <CardContent>
                    <dl className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                カテゴリ
                            </dt>
                            <dd className="mt-1 text-sm">{category.name}</dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                保管場所
                            </dt>
                            <dd className="mt-1 text-sm">{location.name}</dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                基準単位
                            </dt>
                            <dd className="mt-1 text-sm">
                                {item.baseUnit}（
                                {dimensionLabels[item.baseDimension]}）
                            </dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                読書状態
                            </dt>
                            <dd className="mt-1 text-sm">
                                {formatReadingState(item)}
                            </dd>
                        </div>
                        <div className="sm:col-span-2">
                            <dt className="text-sm text-muted-foreground">
                                メモ
                            </dt>
                            <dd className="mt-1 text-sm whitespace-pre-wrap">
                                {item.memo ?? "—"}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                登録日時
                            </dt>
                            <dd className="mt-1 text-sm">
                                {formatDateTime(item.createdAt)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                最終更新
                            </dt>
                            <dd className="mt-1 text-sm">
                                {formatDateTime(item.updatedAt)}
                            </dd>
                        </div>
                    </dl>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>在庫</CardTitle>
                    <CardDescription>
                        現在庫は数量が残っているロットの合計です。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <dl className="grid gap-4 sm:grid-cols-3">
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                現在庫（合計）
                            </dt>
                            <dd
                                className={cn(
                                    "mt-1 font-mono text-xl font-semibold tabular-nums",
                                    lowStock && "text-destructive",
                                )}
                            >
                                {formatQuantity(
                                    item.currentQuantity,
                                    item.baseUnit,
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                下限しきい値
                            </dt>
                            <dd className="mt-1 text-sm">
                                {item.lowStockThreshold === null
                                    ? "未設定"
                                    : formatQuantity(
                                          item.lowStockThreshold,
                                          item.baseUnit,
                                      )}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                最短期限
                            </dt>
                            <dd className="mt-1 text-sm">
                                {formatExpiryDate(item.earliestExpiryDate)}
                            </dd>
                        </div>
                    </dl>

                    {lots.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            数量が残っているロットはありません。
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>期限</TableHead>
                                    <TableHead className="text-right">
                                        数量
                                    </TableHead>
                                    <TableHead>状態</TableHead>
                                    <TableHead className="text-right">
                                        操作
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {lots.map((lot) => {
                                    const signal = resolveExpirySignal(
                                        lot.expiryDate,
                                        now,
                                        soonWithinDays,
                                    );
                                    const editing = editingLotId === lot.id;
                                    return (
                                        <TableRow key={lot.id}>
                                            <TableCell className="whitespace-nowrap align-top">
                                                {editing ? (
                                                    <ItemLotExpiryForm
                                                        itemId={item.id}
                                                        lot={lot}
                                                        onClose={() =>
                                                            setEditingLotId(
                                                                null,
                                                            )
                                                        }
                                                    />
                                                ) : (
                                                    (signal.date ?? "期限なし")
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right align-top font-mono whitespace-nowrap tabular-nums">
                                                {formatQuantity(
                                                    lot.quantity,
                                                    item.baseUnit,
                                                )}
                                            </TableCell>
                                            <TableCell
                                                className={cn(
                                                    "align-top whitespace-nowrap text-sm text-muted-foreground",
                                                    signal.state ===
                                                        "expired" &&
                                                        "font-semibold text-destructive",
                                                )}
                                            >
                                                {/* 余裕のある期限は label が日付そのもので
                                                    期限列と重なるため、注意が要る状態だけ示す */}
                                                {signal.state === "expired" ||
                                                signal.state === "soon"
                                                    ? signal.label
                                                    : "—"}
                                            </TableCell>
                                            <TableCell className="text-right align-top">
                                                <Button
                                                    aria-label={`${signal.date ?? "期限なし"}のロットの期限を変更`}
                                                    disabled={editing}
                                                    onClick={() =>
                                                        setEditingLotId(lot.id)
                                                    }
                                                    size="sm"
                                                    type="button"
                                                    variant="outline"
                                                >
                                                    期限を変更
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>入庫</CardTitle>
                    <CardDescription>
                        この品目に在庫を足します。期限ごとにロットが分かれます。
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ItemReceiveForm item={item} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>価格</CardTitle>
                    <CardDescription>
                        この品目の価格記録を新しい順に表示します。単価は内容量で割った比較用の値です。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-6">
                    <ItemPriceForm item={item} />

                    {priceError ? (
                        <div
                            aria-live="assertive"
                            className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                            role="alert"
                        >
                            <span>{priceError}</span>
                            <Button
                                onClick={() => void priceQuery.refetch()}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                再読み込み
                            </Button>
                        </div>
                    ) : null}

                    {priceRecords.length === 0 ? (
                        <p
                            aria-live="polite"
                            className="text-sm text-muted-foreground"
                        >
                            価格の記録がありません。レシートを反映するか価格 API
                            で記録すると表示されます。
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>店舗</TableHead>
                                    <TableHead>内容量</TableHead>
                                    <TableHead className="text-right">
                                        価格
                                    </TableHead>
                                    <TableHead className="text-right">
                                        単価
                                    </TableHead>
                                    <TableHead>記録日時</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {priceRecords.map((record) => (
                                    <TableRow key={record.id}>
                                        <TableCell className="align-top">
                                            <span className="flex items-center gap-2">
                                                {record.storeFaviconUrl ===
                                                null ? null : (
                                                    <img
                                                        alt=""
                                                        className="size-4 rounded-sm"
                                                        src={
                                                            record.storeFaviconUrl
                                                        }
                                                    />
                                                )}
                                                {record.url === null ? (
                                                    formatStoreLabel(record)
                                                ) : (
                                                    <a
                                                        className="underline underline-offset-4"
                                                        href={record.url}
                                                        rel="noreferrer"
                                                        target="_blank"
                                                    >
                                                        {formatStoreLabel(
                                                            record,
                                                        )}
                                                    </a>
                                                )}
                                            </span>
                                        </TableCell>
                                        <TableCell className="align-top">
                                            {formatContent(record)}
                                        </TableCell>
                                        <TableCell className="text-right align-top font-mono whitespace-nowrap tabular-nums">
                                            {formatPrice(record.price)}
                                        </TableCell>
                                        <TableCell className="text-right align-top whitespace-nowrap">
                                            {formatUnitPrice(record)}
                                        </TableCell>
                                        <TableCell className="align-top whitespace-nowrap">
                                            {formatDateTime(record.recordedAt)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
                <CardFooter className="justify-end">
                    <Button
                        disabled={
                            !priceQuery.hasNextPage ||
                            priceQuery.isFetchingNextPage
                        }
                        onClick={() => void priceQuery.fetchNextPage()}
                        type="button"
                        variant="outline"
                    >
                        {priceQuery.isFetchingNextPage
                            ? "読み込み中…"
                            : "続きを読み込む"}
                    </Button>
                </CardFooter>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>在庫履歴</CardTitle>
                    <CardDescription>
                        この品目の入出庫と棚卸・調整を新しい順に表示します。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    {historyError ? (
                        <div
                            aria-live="assertive"
                            className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                            role="alert"
                        >
                            <span>{historyError}</span>
                            <Button
                                onClick={() => void historyQuery.refetch()}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                再読み込み
                            </Button>
                        </div>
                    ) : null}

                    {movements.length === 0 ? (
                        <p
                            aria-live="polite"
                            className="text-sm text-muted-foreground"
                        >
                            履歴がありません。入庫・出庫・棚卸しを記録すると表示されます。
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>日時</TableHead>
                                    <TableHead>理由</TableHead>
                                    <TableHead className="text-right">
                                        差分
                                    </TableHead>
                                    <TableHead>ロット内訳</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {movements.map((movement) => (
                                    <TableRow key={movement.id}>
                                        <TableCell className="align-top whitespace-nowrap">
                                            {formatDateTime(
                                                movement.occurredAt,
                                            )}
                                        </TableCell>
                                        <TableCell className="align-top">
                                            {reasonLabels[movement.reason]}
                                        </TableCell>
                                        <TableCell className="text-right align-top whitespace-nowrap">
                                            {formatDelta(movement.delta)}{" "}
                                            {item.baseUnit}
                                        </TableCell>
                                        <TableCell className="align-top">
                                            {movement.allocations.length ===
                                            0 ? (
                                                "—"
                                            ) : (
                                                <ul className="flex flex-col gap-1">
                                                    {movement.allocations.map(
                                                        (allocation) => (
                                                            <li
                                                                key={
                                                                    allocation.lotId
                                                                }
                                                            >
                                                                {formatExpiryDate(
                                                                    allocation.expiryDate,
                                                                )}
                                                                :{" "}
                                                                {formatDelta(
                                                                    allocation.delta,
                                                                )}{" "}
                                                                {item.baseUnit}
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
                <CardFooter className="justify-between gap-4">
                    <Link
                        className="text-sm underline underline-offset-4"
                        search={{ itemId }}
                        to="/inventory/history"
                    >
                        履歴の一覧で見る
                    </Link>
                    <Button
                        disabled={
                            !historyQuery.hasNextPage ||
                            historyQuery.isFetchingNextPage
                        }
                        onClick={() => void historyQuery.fetchNextPage()}
                        type="button"
                        variant="outline"
                    >
                        {historyQuery.isFetchingNextPage
                            ? "読み込み中…"
                            : "続きを読み込む"}
                    </Button>
                </CardFooter>
            </Card>
        </main>
    );
}

function ItemDetailPending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                品目を読み込んでいます…
            </p>
        </main>
    );
}

function ItemDetailError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="assertive"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>{errorMessage(error, "品目を読み込めませんでした")}</span>
                <div className="flex gap-2">
                    <Button
                        onClick={() => {
                            reset();
                            void router.invalidate();
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        再読み込み
                    </Button>
                    <Button
                        nativeButton={false}
                        render={<Link to="/inventory/items" />}
                        size="sm"
                        variant="outline"
                    >
                        在庫一覧へ戻る
                    </Button>
                </div>
            </div>
        </main>
    );
}

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

const formatQuantity = (quantity: number, unit: string): string =>
    `${quantity.toLocaleString("ja-JP")} ${unit}`;

const formatDelta = (delta: number): string =>
    `${delta > 0 ? "+" : ""}${delta.toLocaleString("ja-JP")}`;

const formatDateTime = (value: string): string =>
    formatDisplayDateTime(value) ?? value;

const formatExpiryDate = (value: string | null): string =>
    (value === null ? null : formatDisplayDate(value)) ?? "期限なし";

/** 店舗マスタを持たない古い行は自由記述の source をそのまま出す。 */
const formatStoreLabel = (record: PriceRecordDto): string =>
    record.storeName ?? record.source;

/** 内容量は 1 個あたり × 個数で示し、包装があれば併記する。 */
const formatContent = (record: PriceRecordDto): string => {
    const amount = `${record.contentAmount.toLocaleString("ja-JP")} × ${record.setCount} ${record.baseUnit}`;
    return record.packaging === null
        ? amount
        : `${amount}（${record.packaging}）`;
};

const formatPrice = (price: number): string =>
    `¥${price.toLocaleString("ja-JP")}`;

// 単価は 100 g / 100 mL あたりの値なので、kg や L を基準単位にした品目でも
// 比較単位そのものを表示する
const formatUnitPrice = (record: PriceRecordDto): string =>
    `${record.unitPrice.toFixed(2)} 円 / ${priceComparisonBasis(record.baseDimension)} ${priceComparisonUnit(record.baseDimension, record.baseUnit)}`;

/** 読書状態は書籍カテゴリーの品目だけが持つ。未設定は「—」で示す。 */
const formatReadingState = (item: ItemDetailDto): string => {
    if (item.readingStatus === null) return "—";
    const label = readingStatusLabels[item.readingStatus];
    const startedAt = item.readingState?.startedAt ?? null;
    const finishedAt = item.readingState?.finishedAt ?? null;
    const dates = [
        startedAt === null ? null : `開始 ${formatDisplayDate(startedAt)}`,
        finishedAt === null ? null : `読了 ${formatDisplayDate(finishedAt)}`,
    ].filter((value): value is string => value !== null);
    return dates.length === 0 ? label : `${label}（${dates.join(" / ")}）`;
};
