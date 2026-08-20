import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/_master")({
    staticData: {
        breadcrumbs: [{ label: "Inventia", to: "/inventory/items" }],
    },
    component: MasterLayout,
});

function MasterLayout() {
    return <Outlet />;
}
