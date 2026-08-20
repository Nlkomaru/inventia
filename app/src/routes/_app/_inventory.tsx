import { createFileRoute, Outlet } from "@tanstack/react-router";
import { groupBreadcrumb } from "@/lib/navigation";

export const Route = createFileRoute("/_app/_inventory")({
    staticData: {
        breadcrumbs: [groupBreadcrumb("在庫管理")],
    },
    component: InventoryLayout,
});

function InventoryLayout() {
    return <Outlet />;
}
