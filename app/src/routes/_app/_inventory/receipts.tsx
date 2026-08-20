import { createFileRoute, Outlet } from "@tanstack/react-router";

// 取込一覧・新規取込・取込の内容の共通の親。
export const Route = createFileRoute("/_app/_inventory/receipts")({
    staticData: {
        breadcrumbs: [{ label: "レシート取込", to: "/receipts" }],
    },
    component: ReceiptsLayout,
});

function ReceiptsLayout() {
    return <Outlet />;
}
