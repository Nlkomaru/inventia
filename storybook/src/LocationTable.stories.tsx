import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { LocationTable } from "../../app/src/routes/_app/_master/locations/-components/location-table";

const locations = [
	{
		id: "warehouse-1",
		name: "第1倉庫",
		parentId: null,
		sortOrder: 10,
		createdAt: "2026-08-15T00:00:00.000Z",
		updatedAt: "2026-08-15T00:00:00.000Z",
	},
	{
		id: "shelf-a",
		name: "棚A",
		parentId: "warehouse-1",
		sortOrder: 20,
		createdAt: "2026-08-15T00:00:00.000Z",
		updatedAt: "2026-08-15T00:00:00.000Z",
	},
	{
		id: "warehouse-2",
		name: "第2倉庫",
		parentId: null,
		sortOrder: 30,
		createdAt: "2026-08-15T00:00:00.000Z",
		updatedAt: "2026-08-15T00:00:00.000Z",
	},
];

// 場所名は個別ページへの Link になっており、Link は router context を要求する。
// app と同じ実体の router を使うため、workspace の catalog と overrides で
// @tanstack/react-router のバージョンを揃えている
const rootRoute = createRootRoute();
const routeTree = rootRoute.addChildren([
	createRoute({ getParentRoute: () => rootRoute, path: "/" }),
	createRoute({ getParentRoute: () => rootRoute, path: "/locations/$" }),
]);
const storyRouter = createRouter({
	routeTree,
	history: createMemoryHistory({ initialEntries: ["/"] }),
});

const meta = {
	title: "Locations/LocationTable",
	component: LocationTable,
	parameters: {
		layout: "padded",
	},
	decorators: [
		(Story: () => React.JSX.Element) => (
			<RouterProvider
				defaultComponent={() => <Story />}
				router={storyRouter}
			/>
		),
	],
	args: {
		locations,
		itemCounts: { "warehouse-1": 3, "shelf-a": 5 },
		onDelete: async () => undefined,
	},
} satisfies Meta<typeof LocationTable>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
	args: {
		locations: [],
	},
};
