import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../-page-placeholder";

export const Route = createFileRoute("/_app/inventory/history")({
	component: StockHistoryPage,
});

function StockHistoryPage() {
	return (
		<PagePlaceholder
			title="在庫履歴"
			description="入庫、出庫、棚卸・調整の履歴を確認します。"
		/>
	);
}
