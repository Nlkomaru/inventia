import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../../-page-placeholder";

export const Route = createFileRoute("/_app/_master/references/")({
	staticData: {
		breadcrumbs: [{ label: "識別子・外部リンク" }],
	},
	component: ReferencesPage,
});

function ReferencesPage() {
	return (
		<PagePlaceholder
			title="識別子・外部リンク"
			description="識別子用のD1スキーマとAPIの実装後に登録機能を提供します。"
		/>
	);
}
