import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "./-page-placeholder";

export const Route = createFileRoute("/_app/locations")({
	component: LocationsPage,
});

function LocationsPage() {
	return <PagePlaceholder title="保管場所" description="保管場所の階層を管理します。" />;
}
