import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/routes/_app/-page-placeholder";

export const Route = createFileRoute("/_app/_master/locations/")({
	component: LocationsPage,
});

function LocationsPage() {
	return (
		<PagePlaceholder
			title="保管場所"
			description="保管場所の階層を管理します。"
		/>
	);
}
