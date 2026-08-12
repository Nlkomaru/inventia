import { createFileRoute } from "@tanstack/react-router";
import { MasterDataPage } from "@/components/master-data-page";

export const Route = createFileRoute("/_app/_master/categories/")({
	staticData: {
		breadcrumbs: [{ label: "カテゴリ" }],
	},
	component: CategoriesPage,
});

function CategoriesPage() {
	return (
		<MasterDataPage
			title="カテゴリ"
			description="品目を探しやすい分類にまとめ、親子関係を設定します。"
			nameLabel="カテゴリ名"
			codeLabel="カテゴリコード"
			detailLabel="種別"
			hierarchical
			initialRecords={[
				{ id: "daily", name: "日用品", code: "DAILY", detail: "日用品" },
				{
					id: "paper",
					name: "紙製品",
					code: "PAPER",
					parentId: "daily",
					detail: "汎用",
				},
				{ id: "food", name: "食品", code: "FOOD", detail: "食品" },
				{
					id: "dry",
					name: "乾物",
					code: "DRY",
					parentId: "food",
					detail: "食品",
				},
			]}
		/>
	);
}
