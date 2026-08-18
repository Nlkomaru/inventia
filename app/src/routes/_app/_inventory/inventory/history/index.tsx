import {
    useSuspenseInfiniteQuery,
    useSuspenseQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    redirect,
    useRouter,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
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
import {
    type StockMovementReason,
    stockMovementReasonSchema,
    stockMovementReasons,
} from "@/domain/stock";
import { formatDisplayDateTime } from "@/lib/datetime";
import {
    itemListQueryOptions,
    stockHistoryQueryOptions,
} from "./-api/stock-queries";
import { formatDelta } from "./-functions/history-query";

// 絞り込みは URL に持たせる。不正値は既定（絞り込みなし）へ寄せる。
const historySearchSchema = z.object({
    itemId: z.string().min(1).optional().catch(undefined),
    reason: stockMovementReasonSchema.optional().catch(undefined),
});

export const Route = createFileRoute("/_app/_inventory/inventory/history/")({
    validateSearch: historySearchSchema,
    loaderDeps: ({ search }) => search,
    // 履歴取得は未知の itemId を「品目が見つからない」で失敗させるため、
    // ブックマークや削除済み品目の URL でルート全体が落ちないよう、
    // 先に品目一覧で存在を確かめ、無ければ絞り込みを外した URL へ寄せる。
    loader: async ({ context, deps }) => {
        const items = await context.queryClient.ensureQueryData(
            itemListQueryOptions(),
        );
        if (
            deps.itemId !== undefined &&
            !items.some((item) => item.id === deps.itemId)
        ) {
            const { itemId: _unknownItemId, ...rest } = deps;
            throw redirect({ to: "/inventory/history", search: rest });
        }
        await context.queryClient.ensureInfiniteQueryData(
            stockHistoryQueryOptions(deps),
        );
    },
    staticData: {
        breadcrumbs: [{ label: "在庫履歴" }],
    },
    component: StockHistoryPage,
    pendingComponent: StockHistoryPending,
    errorComponent: StockHistoryError,
});

const pageClassName = "mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8";

const reasonLabels: Record<StockMovementReason, string> = {
    purchase: "購入",
    stocktake: "棚卸",
    consume: "消費",
    discard: "廃棄",
    other: "その他",
};

const allFilterValue = "all";

const isReason = (value: string): value is StockMovementReason =>
    stockMovementReasons.some((reason) => reason === value);

function StockHistoryPage() {
    const navigate = Route.useNavigate();
    const search = Route.useSearch();
    const { data: items } = useSuspenseQuery(itemListQueryOptions());
    const historyQuery = useSuspenseInfiniteQuery(
        stockHistoryQueryOptions(search),
    );
    const movements = useMemo(
        () => historyQuery.data.pages.flatMap((page) => page.movements),
        [historyQuery.data],
    );
    const error = historyQuery.error
        ? errorMessage(historyQuery.error, "在庫履歴を読み込めませんでした")
        : null;

    const itemNames = useMemo(
        () => new Map(items.map((item) => [item.id, item.name])),
        [items],
    );
    const itemUnits = useMemo(
        () => new Map(items.map((item) => [item.id, item.baseUnit])),
        [items],
    );

    const itemFilter = search.itemId ?? allFilterValue;
    const reasonFilter = search.reason ?? allFilterValue;
    // 絞り込みは戻る操作の対象にしない（従来は state で保持していた）
    const handleItemFilterChange = (value: string | null) => {
        void navigate({
            replace: true,
            search: {
                ...search,
                itemId:
                    value === null || value === allFilterValue
                        ? undefined
                        : value,
            },
        });
    };
    const handleReasonFilterChange = (value: string | null) => {
        void navigate({
            replace: true,
            search: {
                ...search,
                reason: value !== null && isReason(value) ? value : undefined,
            },
        });
    };

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
        <main className={pageClassName}>
            <header>
                <h1 className="mt-1 text-2xl font-bold">在庫履歴</h1>
            </header>

            <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                <div className="border-b p-5">
                    <h2 className="font-bold">履歴</h2>
                </div>
                <div className="flex flex-col gap-4 p-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                            <FieldLabel htmlFor="history-item">品目</FieldLabel>
                            <Select
                                items={itemFilterOptions}
                                onValueChange={handleItemFilterChange}
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
                                onValueChange={handleReasonFilterChange}
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
                                onClick={() => void historyQuery.refetch()}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                再読み込み
                            </Button>
                        </div>
                    ) : null}
                </div>

                {movements.length === 0 ? (
                    <p
                        aria-live="polite"
                        className="p-5 text-sm text-muted-foreground"
                    >
                        履歴がありません。
                    </p>
                ) : (
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead className="px-5">日時</TableHead>
                                <TableHead className="px-5">品目</TableHead>
                                <TableHead className="px-5">理由</TableHead>
                                <TableHead className="px-5 text-right">
                                    差分
                                </TableHead>
                                <TableHead className="px-5">
                                    ロット内訳
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {movements.map((movement) => {
                                const unit =
                                    itemUnits.get(movement.itemId) ?? "";
                                return (
                                    <TableRow key={movement.id}>
                                        <TableCell className="px-5 py-3 align-top whitespace-nowrap">
                                            {formatDateTime(
                                                movement.occurredAt,
                                            )}
                                        </TableCell>
                                        <TableCell className="px-5 py-3 align-top">
                                            {itemNames.get(movement.itemId) ??
                                                movement.itemId}
                                        </TableCell>
                                        <TableCell className="px-5 py-3 align-top">
                                            {reasonLabels[movement.reason]}
                                        </TableCell>
                                        <TableCell className="px-5 py-3 text-right align-top whitespace-nowrap">
                                            {formatDelta(movement.delta)} {unit}
                                        </TableCell>
                                        <TableCell className="px-5 py-3 align-top">
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
                <div className="flex items-center justify-between border-t p-5">
                    <p className="text-sm text-muted-foreground">
                        {movements.length} 件を表示中
                        {historyQuery.hasNextPage ? "" : "（すべて表示）"}
                    </p>
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
                </div>
            </section>
        </main>
    );
}

function StockHistoryPending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                履歴を読み込んでいます…
            </p>
        </main>
    );
}

function StockHistoryError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="assertive"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>
                    {errorMessage(error, "在庫履歴を読み込めませんでした")}
                </span>
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
            </div>
        </main>
    );
}

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

const formatDateTime = (value: string): string =>
    formatDisplayDateTime(value) ?? value;

const formatExpiry = (value: string | null): string =>
    (value === null ? null : formatDisplayDateTime(value)) ?? "期限なし";
