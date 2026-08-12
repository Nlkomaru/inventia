import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/routes/_app/-page-placeholder";

export const Route = createFileRoute("/_app/license/")({
	staticData: {
		breadcrumbs: [
			{ label: "Inventia", to: "/inventory" },
			{ label: "Licence" },
		],
	},
	component: LicensePage,
});

function LicensePage() {
	return (
		<PagePlaceholder
			description="Inventia のライセンス情報を確認できます。"
			title="Licence"
		/>
	);
}
