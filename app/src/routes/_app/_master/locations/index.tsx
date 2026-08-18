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
    const { data: locations } = useSuspenseQuery(locationTreeQueryOptions());
    return <LocationMasterPage locations={locations} />;
}

function LocationsPending() {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <p className="text-sm text-slate-500">
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
                className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700"
            >
                {error instanceof Error
                    ? error.message
                    : "保管場所を読み込めませんでした"}
            </p>
        </main>
    );
}
