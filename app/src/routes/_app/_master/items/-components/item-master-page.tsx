import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
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
import type { ReadingStateUpsertInput } from "@/domain/reading";
import { buildHierarchyLabels } from "@/lib/hierarchy";
import {
    clearReadingState,
    createItem,
    deleteItem,
    setReadingState,
    updateItem,
} from "../-api/item-api";
import {
    categoryKeys,
    inventoryKeys,
    itemDetailQueryOptions,
    itemKeys,
    locationKeys,
} from "../-api/item-queries";
import type { ReadingStateChange } from "../-functions/reading-state-form";
import { ItemForm } from "./item-form";
import { ItemTable } from "./item-table";

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

type ItemMasterPageProps = {
    items: ItemDto[];
    categories: CategoryDto[];
    locations: LocationDto[];
    categoryFilter: string;
    locationFilter: string;
    onCategoryFilterChange: (value: string) => void;
    onLocationFilterChange: (value: string) => void;
};

export function ItemMasterPage({
    items,
    categories,
    locations,
    categoryFilter,
    locationFilter,
    onCategoryFilterChange,
    onLocationFilterChange,
}: ItemMasterPageProps) {
    const queryClient = useQueryClient();
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [formOpen, setFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<ItemDto | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // 品目の変更は在庫一覧の行・ラベルにも波及するため ["inventory"] も無効化する。
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
    const setReadingStateMutation = useMutation({
        mutationFn: ({
            itemId,
            input,
        }: {
            itemId: string;
            input: ReadingStateUpsertInput;
        }) => setReadingState(itemId, input),
        onSuccess: invalidateItems,
    });
    const clearReadingStateMutation = useMutation({
        mutationFn: (itemId: string) => clearReadingState(itemId),
        onSuccess: invalidateItems,
    });

    // readingStatus が null の品目は読書状態の行を持たないため詳細を取りに行かない。
    // 品目 id が query key に入るため、シートを閉じた後や別の品目へ切り替えた後に
    // 前の応答が届いても混ざらない。
    const readingStateQuery = useQuery({
        ...itemDetailQueryOptions(editingItem?.id ?? ""),
        enabled: editingItem !== null && editingItem.readingStatus !== null,
    });

    const reload = () => {
        setError(null);
        void queryClient.invalidateQueries({ queryKey: itemKeys.all });
        void queryClient.invalidateQueries({ queryKey: categoryKeys.all });
        void queryClient.invalidateQueries({ queryKey: locationKeys.all });
    };

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

    const saveCreate = async (
        input: ItemCreateInput,
        readingState: ReadingStateUpsertInput | null,
    ) => {
        setError(null);
        let created: ItemDto;
        try {
            created = await createMutation.mutateAsync(input);
        } catch (cause) {
            const message = errorMessage(cause, "品目を登録できませんでした");
            setError(message);
            throw new Error(message);
        }
        if (!readingState) return;
        try {
            await setReadingStateMutation.mutateAsync({
                itemId: created.id,
                input: readingState,
            });
        } catch (cause) {
            // 品目の登録は確定しているため、再送で品目が二重に増えないよう
            // 例外を投げ直さず、読書状態だけをやり直せる案内にする
            setError(
                `品目は登録しましたが、読書状態を保存できませんでした（${errorMessage(
                    cause,
                    "原因不明のエラー",
                )}）。編集から設定し直してください`,
            );
        }
    };

    const saveUpdate = async (
        id: string,
        input: ItemUpdateInput,
        readingState: ReadingStateChange,
    ) => {
        setError(null);
        try {
            await updateMutation.mutateAsync({ id, input });
        } catch (cause) {
            const message = errorMessage(cause, "品目を更新できませんでした");
            setError(message);
            throw new Error(message);
        }
        if (readingState.kind === "unchanged") return;
        try {
            if (readingState.kind === "clear") {
                await clearReadingStateMutation.mutateAsync(id);
                return;
            }
            await setReadingStateMutation.mutateAsync({
                itemId: id,
                input: readingState.input,
            });
        } catch (cause) {
            // 品目の更新は確定しているため、こちらも例外を投げ直さない
            setError(
                `品目は更新しましたが、読書状態を保存できませんでした（${errorMessage(
                    cause,
                    "原因不明のエラー",
                )}）。編集から設定し直してください`,
            );
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

    const displayError =
        error ??
        (readingStateQuery.error
            ? errorMessage(
                  readingStateQuery.error,
                  "読書状態を読み込めませんでした",
              )
            : null);

    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <header className="flex items-center justify-between gap-4">
                <h1 className="mt-1 text-2xl font-bold">品目マスタ</h1>
                <Button onClick={openCreate} type="button">
                    <Plus data-icon="inline-start" />
                    品目を登録
                </Button>
            </header>

            {displayError ? (
                <div
                    aria-live="polite"
                    className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                    role="alert"
                >
                    <span>{displayError}</span>
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
                <FieldGroup className="gap-4 md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(10rem,1fr)_minmax(10rem,1fr)]">
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
                readingState={readingStateQuery.data?.readingState ?? null}
                readingStateLoading={readingStateQuery.isLoading}
            />
        </main>
    );
}
