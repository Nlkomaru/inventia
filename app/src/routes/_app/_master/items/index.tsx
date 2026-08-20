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

// 絞り込みは取得済みの一覧に対する画面側の処理のため loaderDeps へは渡さない。
// URL に持たせるのは共有・再訪時に同じ絞り込みへ戻すため。
// 既定値を schema に持たせると /items が正規化 URL へ redirect されるため、
// 未指定は optional のままにして画面側で "all" として扱う。
// 不正値は既定 (絞り込みなし) へ寄せる。
const itemSearchSchema = z.object({
    category: z.string().min(1).optional().catch(undefined),
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

function ItemsPage() {
    const { data: items } = useSuspenseQuery(itemListQueryOptions());
    const { data: categories } = useSuspenseQuery(categoryListQueryOptions());
    const { data: locations } = useSuspenseQuery(locationListQueryOptions());
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
        <ItemMasterPage
            categories={categories}
            categoryFilter={search.category ?? "all"}
            items={items}
            locationFilter={search.location ?? "all"}
            locations={locations}
            onCategoryFilterChange={(value) =>
                void navigate({
                    replace: true,
                    search: (current) => ({
                        ...current,
                        category: value === "all" ? undefined : value,
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
        />
    );
}

function ItemsPending() {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <p className="text-sm text-muted-foreground">
                品目を読み込んでいます…
            </p>
        </main>
    );
}

function ItemsError({ error }: ErrorComponentProps) {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
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
