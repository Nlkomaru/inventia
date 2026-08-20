import { useSuspenseQuery } from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
} from "@tanstack/react-router";
import { providerListQueryOptions } from "./-api/provider-queries";
import { ProviderMasterPage } from "./-components/provider-master-page";

export const Route = createFileRoute("/_app/_master/providers/")({
    loader: ({ context }) =>
        context.queryClient.ensureQueryData(providerListQueryOptions()),
    staticData: {
        breadcrumbs: [{ label: "外部連携先" }],
    },
    component: ProvidersPage,
    pendingComponent: ProvidersPending,
    errorComponent: ProvidersError,
});

function ProvidersPage() {
    const { data } = useSuspenseQuery(providerListQueryOptions());
    return <ProviderMasterPage providers={data} />;
}

function ProvidersPending() {
    return (
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <p className="text-sm text-muted-foreground">
                外部連携先を読み込んでいます…
            </p>
        </main>
    );
}

function ProvidersError({ error }: ErrorComponentProps) {
    return (
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <p
                role="alert"
                className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
                {error instanceof Error
                    ? error.message
                    : "外部連携先を読み込めませんでした"}
            </p>
        </main>
    );
}
