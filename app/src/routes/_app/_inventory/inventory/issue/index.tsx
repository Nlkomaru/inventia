import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/routes/_app/-page-placeholder";

export const Route = createFileRoute("/_app/_inventory/inventory/issue/")({
    staticData: {
        breadcrumbs: [{ label: "出庫" }],
    },
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
