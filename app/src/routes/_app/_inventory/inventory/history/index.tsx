import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { ItemDto } from "@/domain/item";
import {
    type StockMovementDto,
    type StockMovementReason,
    stockMovementReasons,
} from "@/domain/stock";
import { listItems, listStockHistory } from "./-api/stock-api";
import { formatDelta } from "./-functions/history-query";

export const Route = createFileRoute("/_app/_inventory/inventory/history/")({
    staticData: {
        breadcrumbs: [{ label: "在庫履歴" }],
    },
    component: StockHistoryPage,
});

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
});

const pageSize = 50;

const reasonLabels: Record<StockMovementReason, string> = {
    purchase: "購入",
    stocktake: "棚卸",
    consume: "消費",
    discard: "廃棄",
    other: "その他",
};

const allFilterValue = "all";

function StockHistoryPage() {
    const [items, setItems] = useState<ItemDto[]>([]);
    const [movements, setMovements] = useState<StockMovementDto[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [itemFilter, setItemFilter] = useState(allFilterValue);
    const [reasonFilter, setReasonFilter] = useState(allFilterValue);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadItems = useCallback(async () => {
        try {
            setItems(await listItems());
        } catch (cause) {
            setError(errorMessage(cause, "品目を読み込めませんでした"));
        }
    }, []);

    // 絞り込みを変えた場合は cursor を捨てて先頭から読み直す
    const loadFirstPage = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await listStockHistory({
                itemId: itemFilter === allFilterValue ? null : itemFilter,
                reason: reasonFilter === allFilterValue ? null : reasonFilter,
                cursor: null,
                limit: pageSize,
            });
            setMovements(result.movements);
            setNextCursor(result.nextCursor);
        } catch (cause) {
            setMovements([]);
            setNextCursor(null);
            setError(errorMessage(cause, "在庫履歴を読み込めませんでした"));
        } finally {
            setLoading(false);
        }
    }, [itemFilter, reasonFilter]);

    const loadNextPage = useCallback(async () => {
        if (nextCursor === null) return;
        setLoadingMore(true);
        setError(null);
        try {
            const result = await listStockHistory({
                itemId: itemFilter === allFilterValue ? null : itemFilter,
                reason: reasonFilter === allFilterValue ? null : reasonFilter,
                cursor: nextCursor,
                limit: pageSize,
            });
            setMovements((current) => [...current, ...result.movements]);
            setNextCursor(result.nextCursor);
        } catch (cause) {
            setError(errorMessage(cause, "在庫履歴を読み込めませんでした"));
        } finally {
            setLoadingMore(false);
        }
    }, [itemFilter, nextCursor, reasonFilter]);

    useEffect(() => {
        void loadItems();
    }, [loadItems]);

    useEffect(() => {
        void loadFirstPage();
    }, [loadFirstPage]);

    const itemNames = useMemo(
        () => new Map(items.map((item) => [item.id, item.name])),
        [items],
    );
    const itemUnits = useMemo(
        () => new Map(items.map((item) => [item.id, item.baseUnit])),
        [items],
    );

    const itemFilterOptions = [
        { label: "すべての品目", value: allFilterValue },
        ...items.map((item) => ({ label: item.name, value: item.id })),
    ];
    const reasonFilterOptions = [
        { label: "すべての理由", value: allFilterValue },
        ...stockMovementReasons.map((reason) => ({
            label: reasonLabels[reason],
            value: reason,
        })),
    ];

    return (
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
            <header>
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Inventory
                </p>
                <h1 className="mt-1 text-2xl font-bold">在庫履歴</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    入庫、出庫、棚卸・調整の履歴を、期限別の内訳つきで新しい順に表示します。
                </p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle>履歴</CardTitle>
                    <CardDescription>
                        ロット追跡を導入する前に記録された履歴には内訳がありません。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                            <FieldLabel htmlFor="history-item">品目</FieldLabel>
                            <Select
                                disabled={loading && movements.length === 0}
                                items={itemFilterOptions}
                                onValueChange={(value) =>
                                    setItemFilter(value ?? allFilterValue)
                                }
                                value={itemFilter}
                            >
                                <SelectTrigger
                                    className="w-full"
                                    id="history-item"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {itemFilterOptions.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="history-reason">
                                理由
                            </FieldLabel>
                            <Select
                                items={reasonFilterOptions}
                                onValueChange={(value) =>
                                    setReasonFilter(value ?? allFilterValue)
                                }
                                value={reasonFilter}
                            >
                                <SelectTrigger
                                    className="w-full"
                                    id="history-reason"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {reasonFilterOptions.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>

                    {error ? (
                        <div
                            aria-live="assertive"
                            className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                            role="alert"
                        >
                            <span>{error}</span>
                            <Button
                                onClick={() => void loadFirstPage()}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                再読み込み
                            </Button>
                        </div>
                    ) : null}

                    {loading ? (
                        <p
                            aria-live="polite"
                            className="text-sm text-muted-foreground"
                        >
                            履歴を読み込み中…
                        </p>
                    ) : movements.length === 0 ? (
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
                                    <TableHead>品目</TableHead>
                                    <TableHead>理由</TableHead>
                                    <TableHead className="text-right">
                                        差分
                                    </TableHead>
                                    <TableHead>ロット内訳</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {movements.map((movement) => {
                                    const unit =
                                        itemUnits.get(movement.itemId) ?? "";
                                    return (
                                        <TableRow key={movement.id}>
                                            <TableCell className="align-top whitespace-nowrap">
                                                {formatDateTime(
                                                    movement.occurredAt,
                                                )}
                                            </TableCell>
                                            <TableCell className="align-top">
                                                {itemNames.get(
                                                    movement.itemId,
                                                ) ?? movement.itemId}
                                            </TableCell>
                                            <TableCell className="align-top">
                                                {reasonLabels[movement.reason]}
                                            </TableCell>
                                            <TableCell className="text-right align-top whitespace-nowrap">
                                                {formatDelta(movement.delta)}{" "}
                                                {unit}
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
                                                                    {formatExpiry(
                                                                        allocation.expiryDate,
                                                                    )}
                                                                    :{" "}
                                                                    {formatDelta(
                                                                        allocation.delta,
                                                                    )}{" "}
                                                                    {unit}
                                                                </li>
                                                            ),
                                                        )}
                                                    </ul>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
                <CardFooter className="justify-between">
                    <p className="text-sm text-muted-foreground">
                        {movements.length} 件を表示中
                        {nextCursor === null ? "（すべて表示）" : ""}
                    </p>
                    <Button
                        disabled={nextCursor === null || loading || loadingMore}
                        onClick={() => void loadNextPage()}
                        type="button"
                        variant="outline"
                    >
                        {loadingMore ? "読み込み中…" : "続きを読み込む"}
                    </Button>
                </CardFooter>
            </Card>
        </main>
    );
}

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

const formatDateTime = (value: string): string => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
};

const formatExpiry = (value: string | null): string => {
    if (!value) return "期限なし";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "期限なし"
        : dateFormatter.format(date);
};
