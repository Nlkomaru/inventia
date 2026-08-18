import {
    createFileRoute,
    type ErrorComponentProps,
} from "@tanstack/react-router";
import { openRouterStatusQueryOptions } from "./-api/integration-queries";
import { IntegrationsSettingsPage } from "./-components/integrations-settings-page";

export const Route = createFileRoute("/_app/settings/integrations/")({
    // モデル一覧は上流 (OpenRouter) への外向き HTTP で、応答時間を制御できない。
    // loader で待つと初回描画が第三者の遅延に引きずられるため、画面側の useQuery
    // （pending 表示つき）に任せて loader では取得しない。
    loader: ({ context }) =>
        context.queryClient.ensureQueryData(openRouterStatusQueryOptions()),
    staticData: {
        breadcrumbs: [
            { label: "Inventia", to: "/inventory" },
            { label: "設定" },
            { label: "AI・ベクトル検索" },
        ],
    },
    component: IntegrationsSettingsPage,
    pendingComponent: IntegrationsSettingsPending,
    errorComponent: IntegrationsSettingsError,
});

function IntegrationsSettingsPending() {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <p className="text-sm text-muted-foreground">
                連携設定を読み込んでいます…
            </p>
        </main>
    );
}

function IntegrationsSettingsError({ error }: ErrorComponentProps) {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <p
                role="alert"
                className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
                {error instanceof Error
                    ? error.message
                    : "連携設定を読み込めませんでした。"}
            </p>
        </main>
    );
}
