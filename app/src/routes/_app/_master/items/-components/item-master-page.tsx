import { Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { ItemCreateInput, ItemDto, ItemUpdateInput } from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import {
    createItem,
    deleteItem,
    listCategories,
    listItems,
    listLocations,
    updateItem,
} from "./item-api";
import { ItemForm } from "./item-form";
import { getHierarchyLabels } from "./item-options";
import { ItemTable } from "./item-table";

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

export function ItemMasterPage() {
    const [items, setItems] = useState<ItemDto[]>([]);
    const [categories, setCategories] = useState<CategoryDto[]>([]);
    const [locations, setLocations] = useState<LocationDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [locationFilter, setLocationFilter] = useState("all");
    const [formOpen, setFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<ItemDto | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

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
        } catch (cause) {
            setError(errorMessage(cause, "品目を読み込めませんでした"));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const visibleItems = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase("ja");
        return items.filter((item) => {
            if (
                normalizedQuery &&
                !item.name.toLocaleLowerCase("ja").includes(normalizedQuery)
            ) {
                return false;
            }
            if (
                categoryFilter !== "all" &&
                item.categoryId !== categoryFilter
            ) {
                return false;
            }
            return (
                locationFilter === "all" || item.locationId === locationFilter
            );
        });
    }, [categoryFilter, items, locationFilter, query]);

    const openCreate = () => {
        setEditingItem(null);
        setFormOpen(true);
    };

    const openEdit = (item: ItemDto) => {
        setEditingItem(item);
        setFormOpen(true);
    };

    const saveCreate = async (input: ItemCreateInput) => {
        setError(null);
        try {
            const created = await createItem(input);
            setItems((current) => [created, ...current]);
        } catch (cause) {
            const message = errorMessage(cause, "品目を登録できませんでした");
            setError(message);
            throw new Error(message);
        }
    };

    const saveUpdate = async (id: string, input: ItemUpdateInput) => {
        setError(null);
        try {
            const updated = await updateItem(id, input);
            setItems((current) =>
                current.map((item) =>
                    item.id === updated.id ? updated : item,
                ),
            );
        } catch (cause) {
            const message = errorMessage(cause, "品目を更新できませんでした");
            setError(message);
            throw new Error(message);
        }
    };

    const remove = async (item: ItemDto) => {
        if (
            !window.confirm(
                `「${item.name}」を削除しますか？この操作は取り消せません。`,
            )
        ) {
            return;
        }
        setDeletingId(item.id);
        setError(null);
        try {
            await deleteItem(item.id);
            setItems((current) =>
                current.filter((candidate) => candidate.id !== item.id),
            );
        } catch (cause) {
            setError(errorMessage(cause, "品目を削除できませんでした"));
        } finally {
            setDeletingId(null);
        }
    };

    const categoryLabels = useMemo(
        () => getHierarchyLabels(categories),
        [categories],
    );
    const locationLabels = useMemo(
        () => getHierarchyLabels(locations),
        [locations],
    );
    const categoryItems = useMemo(
        () => [
            { label: "すべてのカテゴリ", value: "all" },
            ...categories.map((category) => ({
                label: categoryLabels.get(category.id) ?? category.name,
                value: category.id,
            })),
        ],
        [categories, categoryLabels],
    );
    const locationItems = useMemo(
        () => [
            { label: "すべての保管場所", value: "all" },
            ...locations.map((location) => ({
                label: locationLabels.get(location.id) ?? location.name,
                value: location.id,
            })),
        ],
        [locationLabels, locations],
    );

    return (
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                        Master data
                    </p>
                    <h1 className="mt-1 text-2xl font-bold">品目マスタ</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        在庫数量と保管場所を紐づけて管理する品目を登録します。
                    </p>
                </div>
                <Button onClick={openCreate} type="button">
                    <Plus data-icon="inline-start" />
                    品目を登録
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
                aria-label="品目の検索と絞り込み"
                className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5"
            >
                <FieldGroup className="gap-4 md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(10rem,1fr)_minmax(10rem,1fr)]">
                    <Field>
                        <FieldLabel htmlFor="item-search">
                            品目を検索
                        </FieldLabel>
                        <div className="relative">
                            <Search className="pointer-events-none absolute top-2 left-2.5 text-muted-foreground" />
                            <Input
                                className="pl-9"
                                id="item-search"
                                placeholder="品目名で検索"
                                value={query}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                            />
                        </div>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="item-category-filter">
                            カテゴリ
                        </FieldLabel>
                        <Select
                            items={categoryItems}
                            value={categoryFilter}
                            onValueChange={(value) =>
                                setCategoryFilter(value ?? "all")
                            }
                        >
                            <SelectTrigger
                                className="w-full"
                                id="item-category-filter"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {categoryItems.map((option) => (
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
                        <FieldLabel htmlFor="item-location-filter">
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
                                id="item-location-filter"
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
                </FieldGroup>
            </section>

            <ItemTable
                categories={categories}
                deletingId={deletingId}
                items={visibleItems}
                loading={loading}
                locations={locations}
                onDelete={(item) => void remove(item)}
                onEdit={openEdit}
            />

            <ItemForm
                categories={categories}
                item={editingItem}
                locations={locations}
                onCreate={saveCreate}
                onOpenChange={(open) => {
                    setFormOpen(open);
                    if (!open) setEditingItem(null);
                }}
                onUpdate={saveUpdate}
                open={formOpen}
            />
        </main>
    );
}
