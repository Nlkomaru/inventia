import { createFileRoute } from "@tanstack/react-router";
import { LocationMasterPage } from "./-components/location-master-page";

export const Route = createFileRoute("/_app/_master/locations/")({
	staticData: {
		breadcrumbs: [{ label: "保管場所" }],
	},
	component: LocationsPage,
});

function LocationsPage() {
	return <LocationMasterPage />;
}
