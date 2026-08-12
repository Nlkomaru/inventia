import { createFileRoute } from "@tanstack/react-router";
import { MasterDataPage } from "@/components/master-data-page";

export const Route = createFileRoute("/_app/_master/references/")({
	staticData: {
		breadcrumbs: [{ label: "識別子・外部リンク" }],
	},
	component: ReferencesPage,
});

function ReferencesPage() {
	return (
		<MasterDataPage
			title="識別子・外部リンク"
			description="JAN・ISBN・SKUなど、品目を特定する外部識別子を登録します。"
			nameLabel="対象品目"
			codeLabel="識別子"
			detailLabel="種別・リンク"
			initialRecords={[
				{
					id: "ref-1",
					name: "ボックスティッシュ",
					code: "4900000000001",
					detail: "JAN",
				},
				{
					id: "ref-2",
					name: "デザイン入門",
					code: "9784000000001",
					detail: "ISBN",
				},
			]}
		/>
	);
}
