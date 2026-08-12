import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/routes/_app/-page-placeholder";

export const Route = createFileRoute("/_app/_master/references/")({
	staticData: {
		breadcrumbs: [
			{ label: "マスタ", to: "/items" },
			{ label: "識別子・外部リンク" },
		],
	},
	component: ReferencesPage,
});

function ReferencesPage() {
	return (
		<PagePlaceholder
			title="識別子・外部リンク"
			description="ISBN、JAN、SKU などの識別子と外部リンクを管理します。"
		/>
	);
}
