import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/receipts")({
	component: ReceiptsLayout,
});

function ReceiptsLayout() {
	return <Outlet />;
}
