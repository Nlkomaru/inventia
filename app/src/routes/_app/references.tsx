import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "./-page-placeholder";

export const Route = createFileRoute("/_app/references")({
	component: ReferencesPage,
});

function ReferencesPage() {
	return (
		<PagePlaceholder
			title="識別子・外部リンク"
			description="ISBN、JAN、SKU などの識別子と外部リンクを管理します。"
		/>
	);
}
