import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "../../-page-placeholder";

export const Route = createFileRoute("/_app/_master/categories/")({
    staticData: {
        breadcrumbs: [{ label: "カテゴリ" }],
    },
    component: CategoriesPage,
});

function CategoriesPage() {
    return (
        <PagePlaceholder
            title="カテゴリマスタ"
            description="カテゴリAPIの実装後にD1のデータを表示します。"
        />
    );
}
