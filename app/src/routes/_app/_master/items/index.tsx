import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/routes/_app/-page-placeholder";

export const Route = createFileRoute("/_app/_master/items/")({
	staticData: {
		breadcrumbs: [{ label: "品目" }],
	},
	component: ItemsPage,
});

function ItemsPage() {
	return <PagePlaceholder title="品目" description="品目情報を管理します。" />;
}
