import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/inventory")({
	component: InventoryLayout,
});

function InventoryLayout() {
	return <Outlet />;
}
