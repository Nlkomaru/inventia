import { createFileRoute } from "@tanstack/react-router";
import { ItemMasterPage } from "./-components/item-master-page";

export const Route = createFileRoute("/_app/_master/items/")({
    staticData: {
        breadcrumbs: [{ label: "品目" }],
    },
    component: ItemsPage,
});

function ItemsPage() {
    return <ItemMasterPage />;
}
