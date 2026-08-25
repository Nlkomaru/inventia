import { useSuspenseQuery } from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
} from "@tanstack/react-router";
import { z } from "zod";
import {
    categoryListQueryOptions,
    itemListQueryOptions,
    locationListQueryOptions,
} from "./-api/item-queries";
import { ItemMasterPage } from "./-components/item-master-page";

// 絞り込みと並べ替えは URL に残し、共有・再訪時に同じ表示へ戻す。
// `sort` 未指定は品目名の昇順で読むが、表では「並べ替えなし」として表示する。
const itemSearchSchema = z.object({
    category: z.string().min(1).optional().catch(undefined),
    includeCategoryChildren: z.boolean().optional().catch(undefined),
    location: z.string().min(1).optional().catch(undefined),
    sort: z
        .enum(["name", "category", "location", "baseUnit"])
        .optional()
        .catch(undefined),
    sortDirection: z.enum(["asc", "desc"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/_master/items/")({
    validateSearch: itemSearchSchema,
    loaderDeps: ({ search }) => ({
        sort: search.sort ?? "name",
        sortDirection: search.sortDirection ?? "asc",
    }),
    loader: ({ context, deps }) =>
        Promise.all([
            context.queryClient.ensureQueryData(itemListQueryOptions(deps)),
            context.queryClient.ensureQueryData(categoryListQueryOptions()),
            context.queryClient.ensureQueryData(locationListQueryOptions()),
        ]),
    component: ItemsPage,
    pendingComponent: ItemsPending,
    errorComponent: ItemsError,
});

function ItemsPage() {
    const search = Route.useSearch();
    const sorting = {
        sort: search.sort ?? "name",
        sortDirection: search.sortDirection ?? "asc",
    };
    const { data: items } = useSuspenseQuery(itemListQueryOptions(sorting));
    const { data: categories } = useSuspenseQuery(categoryListQueryOptions());
    const { data: locations } = useSuspenseQuery(locationListQueryOptions());
    const navigate = Route.useNavigate();
    return (
        <ItemMasterPage
            categories={categories}
            categoryFilter={search.category ?? "all"}
            includeCategoryChildren={search.includeCategoryChildren === true}
            items={items}
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
            sort={search.sort ?? null}
            sortDirection={search.sortDirection ?? "asc"}
            onSortChange={(sort, sortDirection) =>
                void navigate({
                    replace: true,
                    search: (current) => ({
                        ...current,
                        sort: sort ?? undefined,
                        sortDirection:
                            sort === null || sortDirection === "asc"
                                ? undefined
                                : sortDirection,
                    }),
                })
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
