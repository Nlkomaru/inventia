import { createFileRoute, Outlet } from "@tanstack/react-router";

// 品目マスタの一覧と個別ページの共通の親。個別ページは自分の段だけを loader から返す。
export const Route = createFileRoute("/_app/_master/items")({
    staticData: {
        breadcrumbs: [{ label: "品目", to: "/items" }],
    },
    component: ItemsLayout,
});

function ItemsLayout() {
    return <Outlet />;
}
