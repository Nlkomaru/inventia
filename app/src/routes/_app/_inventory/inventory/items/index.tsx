import {
    useQuery,
    useQueryClient,
    useSuspenseQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    Link,
    useRouter,
} from "@tanstack/react-router";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
    InventoryTable,
    readingStatusLabels,
    resolveExpirySignal,
} from "@/components/InventoryTable";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { ItemDto } from "@/domain/item";
import { readingStatuses } from "@/domain/reading";
import type { InventoryItemFilters } from "./-api/inventory-api";
import {
    categoryKeys,
    categoryTreeQueryOptions,
    inventoryItemsQueryOptions,
    inventoryKeys,
    itemLotsQueryOptions,
    locationKeys,
    locationTreeQueryOptions,
} from "./-api/inventory-queries";

// 期限が近いと見なす日数。表の色分けと一覧の絞り込みで同じ値を使う
const soonWithinDays = 7;

type ExpiryFilter = "all" | "attention" | "expired" | "none";

const expiryFilterItems: { label: string; value: ExpiryFilter }[] = [
    { label: "すべての期限", value: "all" },
    { label: `期限切れ・${soonWithinDays}日以内`, value: "attention" },
    { label: "期限切れのみ", value: "expired" },
    { label: "期限なしのみ", value: "none" },
];

const isExpiryFilter = (value: string): value is ExpiryFilter =>
    expiryFilterItems.some((option) => option.value === value);

// 読書状態は書籍カテゴリーの品目だけが持つ。`none` は書籍以外と未設定をまとめた選択肢
type ReadingFilter = "all" | (typeof readingStatuses)[number] | "none";

const readingFilterItems: { label: string; value: ReadingFilter }[] = [
    { label: "すべての読書状態", value: "all" },
    { label: readingStatusLabels.unread, value: "unread" },
    { label: readingStatusLabels.reading, value: "reading" },
    { label: readingStatusLabels.finished, value: "finished" },
    { label: "読書状態なし", value: "none" },
];

const isReadingFilter = (value: string): value is ReadingFilter =>
    readingFilterItems.some((option) => option.value === value);

// 絞り込みは URL の search params に持たせて共有・事前読み込みできるようにする。
// 既定値は「絞り込みなし」を意味する未指定とし、不正値は catch で未指定へ寄せる
const inventorySearchSchema = z.object({
    q: z.string().max(200).optional().catch(undefined),
    categoryId: z.string().min(1).optional().catch(undefined),
    locationId: z.string().min(1).optional().catch(undefined),
    lowStockOnly: z.boolean().optional().catch(undefined),
    expiry: z
        .enum(["attention", "expired", "none"])
        .optional()
        .catch(undefined),
    reading: z
        .enum([...readingStatuses, "none"])
        .optional()
        .catch(undefined),
});

type InventorySearch = z.infer<typeof inventorySearchSchema>;

/**
 * URL の絞り込みを service の一覧条件へ変換する。
 * 期限「なしのみ」と読書状態「なし」は service の条件で表現できないため
 * ここでは落とし、取得後の絞り込みで扱う。
 */
const toItemFilters = (search: InventorySearch): InventoryItemFilters => {
    const q = search.q?.trim();
    return {
        q: q ? q : undefined,
        categoryId: search.categoryId,
        locationId: search.locationId,
        lowStockOnly: search.lowStockOnly === true ? true : undefined,
        // 最短期限が now + n 日以内であることは、期限切れ・期限間近と同じ条件になる
        expiringWithinDays:
            search.expiry === "attention"
                ? soonWithinDays
                : search.expiry === "expired"
                  ? 0
                  : undefined,
        readingStatus:
            search.reading && search.reading !== "none"
                ? search.reading
                : undefined,
    };
};

export const Route = createFileRoute("/_app/_inventory/inventory/items/")({
    validateSearch: inventorySearchSchema,
    loaderDeps: ({ search }) => ({ filters: toItemFilters(search) }),
    loader: ({ context, deps }) =>
        Promise.all([
            context.queryClient.ensureQueryData(
                inventoryItemsQueryOptions(deps.filters),
            ),
            context.queryClient.ensureQueryData(categoryTreeQueryOptions()),
            context.queryClient.ensureQueryData(locationTreeQueryOptions()),
        ]),
    component: InventoryPage,
    pendingComponent: InventoryPending,
    errorComponent: InventoryError,
});

// 品目名から詳細ページへ入れるようにする。共有コンポーネントはルーターに
// 依存させないため、リンク要素はルート側で組み立てて渡す
const renderItemName = (item: ItemDto, name: string) => (
    <Link
        className="underline-offset-4 hover:underline"
        params={{ itemId: item.id }}
        to="/inventory/items/$itemId"
    >
        {name}
    </Link>
);

// 保管場所とカテゴリは末端の名前だけを表示する。一覧は行数が多く、
// 親を連ねた経路表示は品目名や期限の視認性を落とす
const toNameMap = (
    nodes: readonly { id: string; name: string }[],
): Map<string, string> => new Map(nodes.map((node) => [node.id, node.name]));

// 入力のたびに URL 更新と再取得を起こさないための待ち時間
const searchDebounceMs = 300;

function InventoryPage() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const queryClient = useQueryClient();
    const filters = useMemo(() => toItemFilters(search), [search]);
    const itemsQuery = useSuspenseQuery(inventoryItemsQueryOptions(filters));
    const { data: categories } = useSuspenseQuery(categoryTreeQueryOptions());
    const { data: locations } = useSuspenseQuery(locationTreeQueryOptions());
    const items = itemsQuery.data;

    // 一覧 DTO は最短期限と件数だけを持つため、内訳が必要な品目だけ個別に取得する。
    // 1 ロットの品目は合計と最短期限で内訳が尽きているので取得しない
    const lotTargetIds = useMemo(
        () => items.filter((item) => item.lotCount > 1).map((item) => item.id),
        [items],
    );
    const lotsQuery = useQuery(itemLotsQueryOptions(lotTargetIds));
    const lotsByItemId = useMemo(
        () =>
            new Map(
                (lotsQuery.data ?? []).map((entry) => [
                    entry.itemId,
                    entry.lots,
                ]),
            ),
        [lotsQuery.data],
    );

    const [queryText, setQueryText] = useState(search.q ?? "");
    // 自分が押し込んだ値かを見分けて、入力中の文字を URL 側の値で上書きしない
    const pushedQueryRef = useRef(search.q ?? "");
    useEffect(() => {
        const urlQuery = search.q ?? "";
        if (urlQuery === pushedQueryRef.current) return;
        pushedQueryRef.current = urlQuery;
        setQueryText(urlQuery);
    }, [search.q]);
    useEffect(() => {
        const nextQuery = queryText.trim();
        if (nextQuery === (search.q ?? "")) return;
        const timer = setTimeout(() => {
            pushedQueryRef.current = nextQuery;
            void navigate({
                search: (prev) => ({
                    ...prev,
                    q: nextQuery === "" ? undefined : nextQuery,
                }),
                replace: true,
            });
        }, searchDebounceMs);
        return () => clearTimeout(timer);
    }, [navigate, queryText, search.q]);

    const categoryLabels = useMemo(() => toNameMap(categories), [categories]);
    const locationLabels = useMemo(() => toNameMap(locations), [locations]);
    const locationItems = useMemo(
        () => [
            { label: "すべての保管場所", value: "all" },
            ...locations.map((location) => ({
                label: location.name,
                value: location.id,
            })),
        ],
        [locations],
    );

    // service の条件で表現できない絞り込みだけを取得後に適用する
    const visibleItems = useMemo(() => {
        if (search.expiry !== "none" && search.reading !== "none") return items;
        const now = Date.now();
        return items.filter((item) => {
            if (search.reading === "none" && item.readingStatus !== null) {
                return false;
            }
            if (search.expiry !== "none") return true;
            const { state } = resolveExpirySignal(
                item.earliestExpiryDate,
                now,
                soonWithinDays,
            );
            return state === "none";
        });
    }, [items, search.expiry, search.reading]);

    const reloading = itemsQuery.isFetching || lotsQuery.isFetching;
    const reload = () => {
        void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
        void queryClient.invalidateQueries({ queryKey: categoryKeys.all });
        void queryClient.invalidateQueries({ queryKey: locationKeys.all });
    };

    return (
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <header className="flex items-center justify-between gap-4">
                <h1 className="mt-1 text-2xl font-bold">在庫一覧</h1>
                <Button
                    disabled={reloading}
                    onClick={reload}
                    type="button"
                    variant="outline"
                >
                    <RefreshCw data-icon="inline-start" />
                    再読み込み
                </Button>
            </header>

            <section aria-label="在庫の検索と絞り込み">
                <FieldGroup className="gap-4 md:grid md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(9rem,1fr))]">
                    <Field>
                        <FieldLabel htmlFor="inventory-search">
                            品目を検索
                        </FieldLabel>
                        <div className="relative">
                            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                className="pl-8"
                                id="inventory-search"
                                placeholder="品目名で検索"
                                value={queryText}
                                onChange={(event) =>
                                    setQueryText(event.target.value)
                                }
                            />
                        </div>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="inventory-location-filter">
                            保管場所
                        </FieldLabel>
                        <Select
                            items={locationItems}
                            value={search.locationId ?? "all"}
                            onValueChange={(value) =>
                                void navigate({
                                    search: (prev) => ({
                                        ...prev,
                                        locationId:
                                            value && value !== "all"
                                                ? value
                                                : undefined,
                                    }),
                                })
                            }
                        >
                            <SelectTrigger
                                className="w-full"
                                id="inventory-location-filter"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {locationItems.map((option) => (
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
                        <FieldLabel htmlFor="inventory-expiry-filter">
                            期限
                        </FieldLabel>
                        <Select
                            items={expiryFilterItems}
                            value={search.expiry ?? "all"}
                            onValueChange={(value) => {
                                const next =
                                    value && isExpiryFilter(value)
                                        ? value
                                        : "all";
                                void navigate({
                                    search: (prev) => ({
                                        ...prev,
                                        expiry:
                                            next === "all" ? undefined : next,
                                    }),
                                });
                            }}
                        >
                            <SelectTrigger
                                className="w-full"
                                id="inventory-expiry-filter"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {expiryFilterItems.map((option) => (
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
                        <FieldLabel htmlFor="inventory-reading-filter">
                            読書状態
                        </FieldLabel>
                        <Select
                            items={readingFilterItems}
                            value={search.reading ?? "all"}
                            onValueChange={(value) => {
                                const next =
                                    value && isReadingFilter(value)
                                        ? value
                                        : "all";
                                void navigate({
                                    search: (prev) => ({
                                        ...prev,
                                        reading:
                                            next === "all" ? undefined : next,
                                    }),
                                });
                            }}
                        >
                            <SelectTrigger
                                className="w-full"
                                id="inventory-reading-filter"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {readingFilterItems.map((option) => (
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
                </FieldGroup>
            </section>

            <InventoryTable
                categoryLabels={categoryLabels}
                items={visibleItems}
                loading={itemsQuery.isFetching}
                locationLabels={locationLabels}
                lotsByItemId={lotsByItemId}
                renderItemName={renderItemName}
                soonWithinDays={soonWithinDays}
            />
        </main>
    );
}

function InventoryPending() {
    return (
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <p className="text-sm text-muted-foreground">
                在庫を読み込んでいます…
            </p>
        </main>
    );
}

function InventoryError({ error }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <div
                aria-live="polite"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>
                    {error instanceof Error
                        ? error.message
                        : "在庫を読み込めませんでした"}
                </span>
                <Button
                    onClick={() => void router.invalidate()}
                    size="sm"
                    type="button"
                    variant="outline"
                >
                    <RefreshCw data-icon="inline-start" />
                    再読み込み
                </Button>
            </div>
        </main>
    );
}
