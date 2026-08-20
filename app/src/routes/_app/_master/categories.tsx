import { createFileRoute, Outlet } from "@tanstack/react-router";

// カテゴリの一覧と個別ページの共通の親。個別ページは祖先の段を loader から返す。
export const Route = createFileRoute("/_app/_master/categories")({
    staticData: {
        breadcrumbs: [{ label: "カテゴリ", to: "/categories" }],
    },
    component: CategoriesLayout,
});

function CategoriesLayout() {
    return <Outlet />;
}
