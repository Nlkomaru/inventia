import { useSuspenseQuery } from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
} from "@tanstack/react-router";
import { locationTreeQueryOptions } from "./-api/location-queries";
import { LocationMasterPage } from "./-components/location-master-page";

export const Route = createFileRoute("/_app/_master/locations/")({
    loader: ({ context }) =>
        context.queryClient.ensureQueryData(locationTreeQueryOptions()),
    staticData: {
        breadcrumbs: [{ label: "保管場所" }],
    },
    component: LocationsPage,
    pendingComponent: LocationsPending,
    errorComponent: LocationsError,
});

function LocationsPage() {
    const { data } = useSuspenseQuery(locationTreeQueryOptions());
    return (
        <LocationMasterPage
            locations={data.locations}
            itemCounts={data.itemCounts}
        />
    );
}

function LocationsPending() {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <p className="text-sm text-muted-foreground">
                保管場所を読み込んでいます…
            </p>
        </main>
    );
}

function LocationsError({ error }: ErrorComponentProps) {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <p
                role="alert"
                className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
                {error instanceof Error
                    ? error.message
                    : "保管場所を読み込めませんでした"}
            </p>
        </main>
    );
}
