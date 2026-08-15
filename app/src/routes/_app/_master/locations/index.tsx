import { createFileRoute } from "@tanstack/react-router";
import { listLocationTree } from "./-components/location-api";
import { LocationMasterPage } from "./-components/location-master-page";

export const Route = createFileRoute("/_app/_master/locations/")({
    loader: () => listLocationTree(),
    staticData: {
        breadcrumbs: [{ label: "保管場所" }],
    },
    component: LocationsPage,
});

function LocationsPage() {
    const locations = Route.useLoaderData();
    return <LocationMasterPage locations={locations} />;
}
