import { createFileRoute, Outlet } from "@tanstack/react-router";
import { groupBreadcrumb } from "@/lib/navigation";

// 価格の区分。URL は変えないため pathless route にする
export const Route = createFileRoute("/_app/_price")({
    staticData: {
        breadcrumbs: [groupBreadcrumb("価格")],
    },
    component: PriceLayout,
});

function PriceLayout() {
    return <Outlet />;
}
