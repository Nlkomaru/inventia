import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    InventoryTable,
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
import type { CategoryDto } from "@/domain/category";
import type { ItemDto } from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import type { ItemLotDto } from "@/domain/lot";
import {
    listCategories,
    listItems,
    listLocations,
    listLotsForItems,
} from "./-api/inventory-api";

export const Route = createFileRoute("/_app/_inventory/inventory/")({
    staticData: {
        breadcrumbs: [{ label: "在庫一覧" }],
    },
    component: InventoryPage,
});

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

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

// 保管場所とカテゴリは末端の名前だけを表示する。一覧は行数が多く、
// 親を連ねた経路表示は品目名や期限の視認性を落とす
const toNameMap = (
    nodes: readonly { id: string; name: string }[],
): Map<string, string> => new Map(nodes.map((node) => [node.id, node.name]));

function InventoryPage() {
    const [items, setItems] = useState<ItemDto[]>([]);
    const [categories, setCategories] = useState<CategoryDto[]>([]);
    const [locations, setLocations] = useState<LocationDto[]>([]);
    const [lotsByItemId, setLotsByItemId] = useState<Map<string, ItemLotDto[]>>(
        new Map(),
    );
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [locationFilter, setLocationFilter] = useState("all");
    const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [nextItems, nextCategories, nextLocations] =
                await Promise.all([
                    listItems(),
                    listCategories(),
                    listLocations(),
                ]);
            setItems(nextItems);
            setCategories(nextCategories);
            setLocations(nextLocations);
            setLotsByItemId(new Map());
            setLoading(false);
            // 内訳の取得は品目ごとの追加リクエストになるため、一覧の表示を待たせない
            setLotsByItemId(await listLotsForItems(nextItems));
        } catch (cause) {
            setError(errorMessage(cause, "在庫を読み込めませんでした"));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

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

    const visibleItems = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase("ja");
        const now = Date.now();
        return items.filter((item) => {
            if (
                normalizedQuery &&
                !item.name.toLocaleLowerCase("ja").includes(normalizedQuery)
            ) {
                return false;
            }
            if (
                locationFilter !== "all" &&
                item.locationId !== locationFilter
            ) {
                return false;
            }
            if (expiryFilter === "all") return true;
            const { state } = resolveExpirySignal(
                item.earliestExpiryDate,
                now,
                soonWithinDays,
            );
            if (expiryFilter === "attention") {
                return state === "expired" || state === "soon";
            }
            if (expiryFilter === "expired") return state === "expired";
            return state === "none";
        });
    }, [expiryFilter, items, locationFilter, query]);

    return (
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                        Inventory
                    </p>
                    <h1 className="mt-1 text-2xl font-bold">在庫一覧</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        数量は期限別ロットの合計です。最短期限と内訳を確認できます。
                    </p>
                </div>
                <Button
                    disabled={loading}
                    onClick={() => void load()}
                    type="button"
                    variant="outline"
                >
                    <RefreshCw data-icon="inline-start" />
                    再読み込み
                </Button>
            </header>

            {error ? (
                <div
                    aria-live="polite"
                    className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                    role="alert"
                >
                    <span>{error}</span>
                    <Button
                        onClick={() => void load()}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        <RefreshCw data-icon="inline-start" />
                        再読み込み
                    </Button>
                </div>
            ) : null}

            <section
                aria-label="在庫の検索と絞り込み"
                className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5"
            >
                <FieldGroup className="gap-4 md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(10rem,1fr)_minmax(10rem,1fr)]">
                    <Field>
                        <FieldLabel htmlFor="inventory-search">
                            品目を検索
                        </FieldLabel>
                        <div className="relative">
                            <Search className="pointer-events-none absolute top-2 left-2.5 text-muted-foreground" />
                            <Input
                                className="pl-9"
                                id="inventory-search"
                                placeholder="品目名で検索"
                                value={query}
                                onChange={(event) =>
                                    setQuery(event.target.value)
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
                            value={locationFilter}
                            onValueChange={(value) =>
                                setLocationFilter(value ?? "all")
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
                            value={expiryFilter}
                            onValueChange={(value) =>
                                setExpiryFilter(
                                    value && isExpiryFilter(value)
                                        ? value
                                        : "all",
                                )
                            }
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
                </FieldGroup>
            </section>

            <InventoryTable
                categoryLabels={categoryLabels}
                items={visibleItems}
                loading={loading}
                locationLabels={locationLabels}
                lotsByItemId={lotsByItemId}
                soonWithinDays={soonWithinDays}
            />
        </main>
    );
}
