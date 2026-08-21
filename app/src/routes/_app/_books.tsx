import { createFileRoute, Outlet } from "@tanstack/react-router";
import { groupBreadcrumb } from "@/lib/navigation";

// 書籍の区分。URL は変えないため pathless route にする
export const Route = createFileRoute("/_app/_books")({
    staticData: {
        breadcrumbs: [groupBreadcrumb("書籍")],
    },
    component: BooksLayout,
});

function BooksLayout() {
    return <Outlet />;
}
