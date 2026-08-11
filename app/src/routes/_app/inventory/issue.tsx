import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../-page-placeholder";

export const Route = createFileRoute("/_app/inventory/issue")({
	component: IssueStockPage,
});

function IssueStockPage() {
	return (
		<PagePlaceholder
			title="出庫"
			description="消費・廃棄などによる在庫の減少を記録します。"
		/>
	);
}
