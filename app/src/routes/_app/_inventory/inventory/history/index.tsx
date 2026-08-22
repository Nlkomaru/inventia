import {
    useSuspenseInfiniteQuery,
    useSuspenseQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    Link,
    redirect,
    useRouter,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { InfiniteScrollSentinel } from "@/components/infinite-scroll-sentinel";
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
    type StockMovementDto,
    type StockMovementReason,
    stockMovementReasonSchema,
    stockMovementReasons,
} from "@/domain/stock";
import { formatDisplayDateTime } from "@/lib/datetime";
// 連携先の表示はマスタ画面と同じ部品を使う
import { ProviderFavicon } from "@/routes/_app/_master/providers/-components/provider-favicon";
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

const pageClassName = "w-full space-y-6 p-4 sm:p-6 lg:p-8";

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
                    <Table aria-label="在庫履歴">
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
                                <TableHead className="px-5">用途</TableHead>
                                <TableHead className="px-5">連携先</TableHead>
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
                                            {/* 品目名から詳細ページへ入れるようにする */}
                                            <Link
                                                className="underline-offset-4 hover:underline"
                                                params={{
                                                    itemId: movement.itemId,
                                                }}
                                                to="/inventory/items/$itemId"
                                            >
                                                {itemNames.get(
                                                    movement.itemId,
                                                ) ?? movement.itemId}
                                            </Link>
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
                                        <TableCell className="px-5 py-3 align-top">
                                            {movement.note ?? "—"}
                                        </TableCell>
                                        {/* 外部 ID は連携先アプリ用の値なので表示しない */}
                                        <TableCell className="px-5 py-3 align-top">
                                            {movement.externalProvider ? (
                                                <ExternalProviderCell
                                                    provider={
                                                        movement.externalProvider
                                                    }
                                                />
                                            ) : (
                                                "—"
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
                <InfiniteScrollSentinel
                    hasNextPage={historyQuery.hasNextPage}
                    isFetchingNextPage={historyQuery.isFetchingNextPage}
                    onLoadMore={() => void historyQuery.fetchNextPage()}
                />
            </section>
        </main>
    );
}

type MovementExternalProvider = NonNullable<
    StockMovementDto["externalProvider"]
>;

/** 連携先はファビコンと名前で示し、URL を持つものだけリンクにする。 */
function ExternalProviderCell({
    provider,
}: {
    provider: MovementExternalProvider;
}) {
    const content = (
        <>
            <ProviderFavicon faviconUrl={provider.faviconUrl} />
            <span>{provider.name}</span>
        </>
    );
    return provider.url === null ? (
        <span className="flex items-center gap-2">{content}</span>
    ) : (
        <a
            className="flex items-center gap-2 underline underline-offset-4 hover:text-primary"
            href={provider.url}
            rel="noreferrer"
            target="_blank"
        >
            {content}
        </a>
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
