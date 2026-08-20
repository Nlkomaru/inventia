import { createFileRoute, Outlet } from "@tanstack/react-router";
import { groupBreadcrumb } from "@/lib/navigation";

export const Route = createFileRoute("/_app/_master")({
    staticData: {
        breadcrumbs: [groupBreadcrumb("マスタ")],
    },
    component: MasterLayout,
});

function MasterLayout() {
    return <Outlet />;
}
