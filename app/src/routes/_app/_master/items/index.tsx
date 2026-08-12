import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../../-page-placeholder";

export const Route = createFileRoute("/_app/_master/items/")({
	staticData: {
		breadcrumbs: [{ label: "品目" }],
	},
	component: ItemsPage,
});

function ItemsPage() {
	return (
		<PagePlaceholder
			title="品目マスタ"
			description="品目は在庫登録画面からD1へ登録します。"
		/>
	);
}
