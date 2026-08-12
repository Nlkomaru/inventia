import { createFileRoute } from "@tanstack/react-router";
import { MasterDataPage } from "@/components/master-data-page";

export const Route = createFileRoute("/_app/_master/locations/")({
	staticData: {
		breadcrumbs: [{ label: "保管場所" }],
	},
	component: LocationsPage,
});

function LocationsPage() {
	return (
		<MasterDataPage
			title="保管場所"
			description="建物から棚まで、在庫の保管場所を階層で整理します。"
			nameLabel="場所名"
			codeLabel="場所コード"
			detailLabel="メモ"
			hierarchical
			initialRecords={[
				{ id: "home", name: "自宅", code: "HOME", detail: "" },
				{
					id: "kitchen",
					name: "キッチン",
					code: "KIT",
					parentId: "home",
					detail: "1階",
				},
				{
					id: "pantry",
					name: "パントリー",
					code: "PANTRY",
					parentId: "kitchen",
					detail: "食品・日用品",
				},
				{
					id: "office",
					name: "書斎",
					code: "OFFICE",
					parentId: "home",
					detail: "2階",
				},
			]}
		/>
	);
}
