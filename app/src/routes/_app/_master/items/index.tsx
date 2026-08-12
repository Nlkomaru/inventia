import { createFileRoute } from "@tanstack/react-router";
import { MasterDataPage } from "@/components/master-data-page";

export const Route = createFileRoute("/_app/_master/items/")({
	staticData: {
		breadcrumbs: [{ label: "品目" }],
	},
	component: ItemsPage,
});

function ItemsPage() {
	return (
		<MasterDataPage
			title="品目"
			description="在庫として扱う品目の基本情報を登録します。"
			nameLabel="品目名"
			codeLabel="品目コード"
			detailLabel="基準単位"
			initialRecords={[
				{
					id: "tissue",
					name: "ボックスティッシュ",
					code: "ITEM-001",
					detail: "箱",
				},
				{ id: "rice", name: "こしひかり", code: "ITEM-002", detail: "g" },
				{ id: "coffee", name: "コーヒー豆", code: "ITEM-003", detail: "g" },
			]}
		/>
	);
}
