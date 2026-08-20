import { useSuspenseQuery } from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
} from "@tanstack/react-router";
import { categoryTreeQueryOptions } from "./-api/category-queries";
import { CategoryMasterPage } from "./-components/category-master-page";

export const Route = createFileRoute("/_app/_master/categories/")({
    loader: ({ context }) =>
        context.queryClient.ensureQueryData(categoryTreeQueryOptions()),
    staticData: {
        breadcrumbs: [{ label: "カテゴリ" }],
    },
    component: CategoriesPage,
    pendingComponent: CategoriesPending,
    errorComponent: CategoriesError,
});

function CategoriesPage() {
    const { data } = useSuspenseQuery(categoryTreeQueryOptions());
    return (
        <CategoryMasterPage
            categories={data.items}
            truncated={data.truncated}
        />
    );
}

function CategoriesPending() {
    return (
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <p className="text-sm text-muted-foreground">
                カテゴリを読み込んでいます…
            </p>
        </main>
    );
}

function CategoriesError({ error }: ErrorComponentProps) {
    return (
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <p
                role="alert"
                className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
                {error instanceof Error
                    ? error.message
                    : "カテゴリを読み込めませんでした"}
            </p>
        </main>
    );
}
