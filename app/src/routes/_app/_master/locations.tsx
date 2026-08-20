import { createFileRoute, Outlet } from "@tanstack/react-router";

// 保管場所の一覧と個別ページの共通の親。個別ページは祖先の段を loader から返す。
export const Route = createFileRoute("/_app/_master/locations")({
    staticData: {
        breadcrumbs: [{ label: "保管場所", to: "/locations" }],
    },
    component: LocationsLayout,
});

function LocationsLayout() {
    return <Outlet />;
}
