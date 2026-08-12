import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/routes/_app/-page-placeholder";

export const Route = createFileRoute("/_app/inventory/receive/")({
	component: ReceiveStockPage,
});

function ReceiveStockPage() {
	return (
		<PagePlaceholder
			title="入庫"
			description="購入・補充した品目の入庫を登録します。"
		/>
	);
}
