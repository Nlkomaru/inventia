import {
    keepPreviousData,
    useQuery,
    useSuspenseQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import type { ItemListSort, ItemSortDirection } from "@/domain/item";
import {
    categoryListQueryOptions,
    itemListQueryOptions,
    locationListQueryOptions,
} from "./-api/item-queries";
import { ItemMasterPage } from "./-components/item-master-page";

// 絞り込みは URL に残し、共有・再訪時に同じ表示へ戻す。
// 並べ替えは画面内の query だけを差し替え、route loader を再実行しない。
const itemSearchSchema = z.object({
    category: z.string().min(1).optional().catch(undefined),
    includeCategoryChildren: z.boolean().optional().catch(undefined),
    location: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/_master/items/")({
    validateSearch: itemSearchSchema,
    loader: ({ context }) =>
        Promise.all([
            context.queryClient.ensureQueryData(itemListQueryOptions()),
            context.queryClient.ensureQueryData(categoryListQueryOptions()),
            context.queryClient.ensureQueryData(locationListQueryOptions()),
        ]),
    component: ItemsPage,
    pendingComponent: ItemsPending,
    errorComponent: ItemsError,
});

type ItemMasterSort = Exclude<ItemListSort, "expiry">;

function ItemsPage() {
    const search = Route.useSearch();
    const [sorting, setSorting] = useState<{
        sort: ItemMasterSort | null;
        sortDirection: ItemSortDirection;
    }>({ sort: null, sortDirection: "asc" });
    const itemQuery = useQuery({
        ...itemListQueryOptions({
            sort: sorting.sort ?? "name",
            sortDirection:
                sorting.sort === null ? "asc" : sorting.sortDirection,
        }),
        placeholderData: keepPreviousData,
    });
    const { data: categories } = useSuspenseQuery(categoryListQueryOptions());
    const { data: locations } = useSuspenseQuery(locationListQueryOptions());
    const navigate = Route.useNavigate();
    return (
        <ItemMasterPage
            categories={categories}
            categoryFilter={search.category ?? "all"}
            includeCategoryChildren={search.includeCategoryChildren === true}
            items={itemQuery.data ?? []}
            locationFilter={search.location ?? "all"}
            locations={locations}
            onCategoryFilterChange={(value) =>
                void navigate({
                    replace: true,
                    search: (current) => ({
                        ...current,
                        category: value === "all" ? undefined : value,
                        includeCategoryChildren:
                            value === "all"
                                ? undefined
                                : current.includeCategoryChildren,
                    }),
                })
            }
            onIncludeCategoryChildrenChange={(checked) =>
                void navigate({
                    replace: true,
                    search: (current) => ({
                        ...current,
                        includeCategoryChildren: checked ? true : undefined,
                    }),
                })
            }
            onLocationFilterChange={(value) =>
                void navigate({
                    replace: true,
                    search: (current) => ({
                        ...current,
                        location: value === "all" ? undefined : value,
                    }),
                })
            }
            sort={sorting.sort}
            sortDirection={sorting.sortDirection}
            onSortChange={(sort, sortDirection) =>
                setSorting({ sort, sortDirection })
            }
        />
    );
}

function ItemsPending() {
    return (
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <p className="text-sm text-muted-foreground">
                品目を読み込んでいます…
            </p>
        </main>
    );
}

function ItemsError({ error }: ErrorComponentProps) {
    return (
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
                {error instanceof Error
                    ? error.message
                    : "品目を読み込めませんでした"}
            </p>
        </main>
    );
}
