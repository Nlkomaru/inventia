import { Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type {
    ReadingStateDto,
    ReadingStateUpsertInput,
    ReadingStatus,
} from "@/domain/reading";
import type { ReadingStateChange } from "../-functions/reading-state-form";
import {
    clearReadingState,
    createItem,
    deleteItem,
    getItem,
    listCategories,
    listItems,
    listLocations,
    setReadingState,
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
    const [editingReadingState, setEditingReadingState] =
        useState<ReadingStateDto | null>(null);
    const [readingStateLoading, setReadingStateLoading] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    // 読書状態の取得が返る頃にシートが閉じている・別の品目に切り替わっている
    // 場合があるため、開いている品目を参照で追う
    const editingItemIdRef = useRef<string | null>(null);

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
        editingItemIdRef.current = null;
        setEditingItem(null);
        setEditingReadingState(null);
        setReadingStateLoading(false);
        setFormOpen(true);
    };

    const openEdit = (item: ItemDto) => {
        editingItemIdRef.current = item.id;
        setEditingItem(item);
        setEditingReadingState(null);
        setFormOpen(true);
        // readingStatus が null の品目は読書状態の行を持たないため詳細を取りに行かない
        if (item.readingStatus === null) {
            setReadingStateLoading(false);
            return;
        }
        setReadingStateLoading(true);
        void (async () => {
            try {
                const detail = await getItem(item.id);
                if (editingItemIdRef.current !== item.id) return;
                setEditingReadingState(detail.readingState);
            } catch (cause) {
                if (editingItemIdRef.current !== item.id) return;
                setError(errorMessage(cause, "読書状態を読み込めませんでした"));
            } finally {
                if (editingItemIdRef.current === item.id) {
                    setReadingStateLoading(false);
                }
            }
        })();
    };

    const applyReadingStatus = (id: string, status: ReadingStatus | null) => {
        setItems((current) =>
            current.map((item) =>
                item.id === id ? { ...item, readingStatus: status } : item,
            ),
        );
    };

    const saveCreate = async (
        input: ItemCreateInput,
        readingState: ReadingStateUpsertInput | null,
    ) => {
        setError(null);
        let created: ItemDto;
        try {
            created = await createItem(input);
        } catch (cause) {
            const message = errorMessage(cause, "品目を登録できませんでした");
            setError(message);
            throw new Error(message);
        }
        setItems((current) => [created, ...current]);
        if (!readingState) return;
        try {
            const saved = await setReadingState(created.id, readingState);
            applyReadingStatus(created.id, saved.status);
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
        let updated: ItemDto;
        try {
            updated = await updateItem(id, input);
        } catch (cause) {
            const message = errorMessage(cause, "品目を更新できませんでした");
            setError(message);
            throw new Error(message);
        }
        setItems((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
        );
        if (readingState.kind === "unchanged") return;
        try {
            if (readingState.kind === "clear") {
                await clearReadingState(id);
                applyReadingStatus(id, null);
                return;
            }
            const saved = await setReadingState(id, readingState.input);
            applyReadingStatus(id, saved.status);
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
                    if (open) return;
                    editingItemIdRef.current = null;
                    setEditingItem(null);
                    setEditingReadingState(null);
                    setReadingStateLoading(false);
                }}
                onUpdate={saveUpdate}
                open={formOpen}
                readingState={editingReadingState}
                readingStateLoading={readingStateLoading}
            />
        </main>
    );
}
