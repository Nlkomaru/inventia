import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/_inventory/inventory/")({
    staticData: {
        breadcrumbs: [{ label: "在庫一覧" }],
    },
    component: InventoryPage,
});

const placeholderIds = Array.from(
    { length: 24 },
    (_, index) => `inventory-placeholder-${index}`,
);

function InventoryPage() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4">
            {placeholderIds.map((placeholderId) => (
                <div
                    key={placeholderId}
                    className="aspect-video h-12 w-full rounded-lg bg-muted/50"
                />
            ))}
        </div>
    );
}
