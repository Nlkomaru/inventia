import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/routes/_app/-page-placeholder";

export const Route = createFileRoute("/_app/inventory/stocktake/")({
	component: StocktakePage,
});

function StocktakePage() {
	return (
		<PagePlaceholder
			title="棚卸・調整"
			description="実在庫を入力し、差分を在庫履歴へ記録します。"
		/>
	);
}
