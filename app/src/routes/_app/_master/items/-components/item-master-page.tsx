import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type {
    ItemCreateInput,
    ItemDto,
    ItemListSort,
    ItemSortDirection,
    ItemUpdateInput,
} from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import { buildHierarchyLabels, collectDescendantIds } from "@/lib/hierarchy";
import { createItem, deleteItem, updateItem } from "../-api/item-api";
import {
    categoryKeys,
    inventoryKeys,
    itemKeys,
    locationKeys,
} from "../-api/item-queries";
import { ItemForm } from "./item-form";
import { ItemTable } from "./item-table";

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

type ItemMasterSort = Exclude<ItemListSort, "expiry">;

type ItemMasterPageProps = {
    items: ItemDto[];
    categories: CategoryDto[];
    locations: LocationDto[];
    categoryFilter: string;
    includeCategoryChildren: boolean;
    locationFilter: string;
    sort: ItemMasterSort | null;
    sortDirection: ItemSortDirection;
    onCategoryFilterChange: (value: string) => void;
    onIncludeCategoryChildrenChange: (checked: boolean) => void;
    onLocationFilterChange: (value: string) => void;
    onSortChange: (
        sort: ItemMasterSort | null,
        sortDirection: ItemSortDirection,
    ) => void;
};

export function ItemMasterPage({
    items,
    categories,
    locations,
    categoryFilter,
    includeCategoryChildren,
    locationFilter,
    onCategoryFilterChange,
    onIncludeCategoryChildrenChange,
    onLocationFilterChange,
    sort,
    sortDirection,
    onSortChange,
}: ItemMasterPageProps) {
    const queryClient = useQueryClient();
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [formOpen, setFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<ItemDto | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // 品目の変更は在庫一覧の行・ラベルにも波及するため、
    // ["inventory"] も無効化する。
    // onSuccess の Promise を返すと mutateAsync が再取得完了まで待つ。
    const invalidateItems = () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: itemKeys.all }),
            queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
        ]);
    const createMutation = useMutation({
        mutationFn: (input: ItemCreateInput) => createItem(input),
        onSuccess: invalidateItems,
    });
    const updateMutation = useMutation({
        mutationFn: ({ id, input }: { id: string; input: ItemUpdateInput }) =>
            updateItem(id, input),
        onSuccess: invalidateItems,
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteItem(id),
        onSuccess: invalidateItems,
    });

    const reload = () => {
        setError(null);
        void queryClient.invalidateQueries({ queryKey: itemKeys.all });
        void queryClient.invalidateQueries({ queryKey: categoryKeys.all });
        void queryClient.invalidateQueries({ queryKey: locationKeys.all });
    };

    const categoryFilterIds = useMemo(() => {
        if (categoryFilter === "all") return null;
        return includeCategoryChildren
            ? collectDescendantIds(categories, categoryFilter)
            : new Set([categoryFilter]);
    }, [categories, categoryFilter, includeCategoryChildren]);

    const normalizedQuery = query.trim().toLocaleLowerCase("ja");
    const visibleItems = items.filter((item) => {
        if (
            normalizedQuery &&
            !item.name.toLocaleLowerCase("ja").includes(normalizedQuery)
        ) {
            return false;
        }
        if (categoryFilterIds && !categoryFilterIds.has(item.categoryId)) {
            return false;
        }
        return locationFilter === "all" || item.locationId === locationFilter;
    });

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
            await createMutation.mutateAsync(input);
        } catch (cause) {
            const message = errorMessage(cause, "品目を登録できませんでした");
            setError(message);
            throw new Error(message);
        }
    };

    const saveUpdate = async (id: string, input: ItemUpdateInput) => {
        setError(null);
        try {
            await updateMutation.mutateAsync({ id, input });
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
            await deleteMutation.mutateAsync(item.id);
        } catch (cause) {
            setError(errorMessage(cause, "品目を削除できませんでした"));
        } finally {
            setDeletingId(null);
        }
    };

    const categoryLabels = useMemo(
        () => buildHierarchyLabels(categories),
        [categories],
    );
    const locationLabels = useMemo(
        () => buildHierarchyLabels(locations),
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
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <header className="flex items-center justify-between gap-4">
                <h1 className="mt-1 text-2xl font-bold">品目マスタ</h1>
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
                        onClick={reload}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        <RefreshCw data-icon="inline-start" />
                        再読み込み
                    </Button>
                </div>
            ) : null}

            <section aria-label="品目の検索と絞り込み">
                <FieldGroup className="gap-4 md:grid md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(24rem,1fr)_minmax(10rem,1fr)]">
                    <Field>
                        <FieldLabel htmlFor="item-search">
                            品目を検索
                        </FieldLabel>
                        <div className="relative">
                            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                className="pl-8"
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
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="w-0 min-w-40 flex-1">
                                <Select
                                    items={categoryItems}
                                    value={categoryFilter}
                                    onValueChange={(value) =>
                                        onCategoryFilterChange(value ?? "all")
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
                            </div>
                            <Field
                                className="w-auto shrink-0 rounded-md border bg-muted/40 px-2.5 py-2 shadow-xs"
                                orientation="horizontal"
                            >
                                <Checkbox
                                    checked={includeCategoryChildren}
                                    disabled={categoryFilter === "all"}
                                    id="item-category-descendants"
                                    onCheckedChange={
                                        onIncludeCategoryChildrenChange
                                    }
                                />
                                <FieldLabel
                                    className="cursor-pointer whitespace-nowrap text-xs font-medium"
                                    htmlFor="item-category-descendants"
                                >
                                    子も表示
                                </FieldLabel>
                            </Field>
                        </div>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="item-location-filter">
                            保管場所
                        </FieldLabel>
                        <Select
                            items={locationItems}
                            value={locationFilter}
                            onValueChange={(value) =>
                                onLocationFilterChange(value ?? "all")
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
                locations={locations}
                sort={sort}
                sortDirection={sortDirection}
                onSortChange={onSortChange}
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
                    if (open) return;
                    setEditingItem(null);
                }}
                onUpdate={saveUpdate}
                open={formOpen}
            />
        </main>
    );
}
