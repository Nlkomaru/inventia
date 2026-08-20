import { useSuspenseQuery } from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
} from "@tanstack/react-router";
import { storeListQueryOptions } from "./-api/store-queries";
import { StoreMasterPage } from "./-components/store-master-page";

export const Route = createFileRoute("/_app/_price/stores/")({
    loader: ({ context }) =>
        context.queryClient.ensureQueryData(storeListQueryOptions()),
    staticData: {
        breadcrumbs: [{ label: "店舗" }],
    },
    component: StoresPage,
    pendingComponent: StoresPending,
    errorComponent: StoresError,
});

function StoresPage() {
    const { data } = useSuspenseQuery(storeListQueryOptions());
    return <StoreMasterPage stores={data} />;
}

function StoresPending() {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <p className="text-sm text-muted-foreground">
                店舗を読み込んでいます…
            </p>
        </main>
    );
}

function StoresError({ error }: ErrorComponentProps) {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <p
                role="alert"
                className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
                {error instanceof Error
                    ? error.message
                    : "店舗を読み込めませんでした"}
            </p>
        </main>
    );
}
