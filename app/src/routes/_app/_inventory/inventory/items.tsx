import { createFileRoute, Outlet } from "@tanstack/react-router";

// 在庫一覧と品目詳細の共通の親。ここに段を置くことで、配下の画面は
// 自分の段だけを名乗ればパンくずが 在庫管理 > 在庫一覧 > … と揃う
export const Route = createFileRoute("/_app/_inventory/inventory/items")({
    staticData: {
        breadcrumbs: [{ label: "在庫一覧", to: "/inventory/items" }],
    },
    component: InventoryItemsLayout,
});

function InventoryItemsLayout() {
    return <Outlet />;
}
