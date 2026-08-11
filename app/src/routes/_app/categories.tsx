import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "./-page-placeholder";

export const Route = createFileRoute("/_app/categories")({
	component: CategoriesPage,
});

function CategoriesPage() {
	return (
		<PagePlaceholder
			title="カテゴリ"
			description="品目のカテゴリを管理します。"
		/>
	);
}
