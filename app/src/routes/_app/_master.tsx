import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/_master")({
	component: MasterLayout,
});

function MasterLayout() {
	return <Outlet />;
}
