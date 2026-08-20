import { createFileRoute, Outlet } from "@tanstack/react-router";
import { groupBreadcrumb } from "@/lib/navigation";

// 連携・設定の区分。/settings 自体に画面は無く、配下の設定画面だけを持つ
export const Route = createFileRoute("/_app/settings")({
    staticData: {
        breadcrumbs: [groupBreadcrumb("連携・設定")],
    },
    component: SettingsLayout,
});

function SettingsLayout() {
    return <Outlet />;
}
