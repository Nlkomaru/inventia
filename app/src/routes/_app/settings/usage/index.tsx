import { createFileRoute } from "@tanstack/react-router";
import { UsagePage } from "./-components/usage-page";

export const Route = createFileRoute("/_app/settings/usage/")({
    staticData: {
        breadcrumbs: [{ label: "利用状況" }],
    },
    component: UsagePage,
});
