import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/routes/_app/-page-placeholder";

export const Route = createFileRoute("/_app/receipts/new/")({
	staticData: {
		breadcrumbs: [
			{ label: "在庫管理", to: "/inventory" },
			{ label: "レシート取込" },
		],
	},
	component: ReceiptUploadPage,
});

function ReceiptUploadPage() {
	return (
		<PagePlaceholder
			title="レシート取込"
			description="レシート画像をアップロードし、確認後に購入・在庫へ反映します。"
		/>
	);
}
