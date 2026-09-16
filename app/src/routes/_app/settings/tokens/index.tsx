import { createFileRoute } from "@tanstack/react-router";
import { TokenSettingsPage } from "./-components/token-settings-page";

export const Route = createFileRoute("/_app/settings/tokens/")({
    staticData: {
        breadcrumbs: [{ label: "API トークン" }],
    },
    component: TokenSettingsPage,
});
