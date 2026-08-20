import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/_inventory")({
    staticData: {
        breadcrumbs: [{ label: "在庫管理", to: "/inventory/items" }],
    },
    component: InventoryLayout,
});

function InventoryLayout() {
    return <Outlet />;
}
