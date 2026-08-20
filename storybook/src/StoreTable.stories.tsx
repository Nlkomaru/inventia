import type { Meta, StoryObj } from "@storybook/react-vite";
import { StoreTable } from "../../app/src/routes/_app/_master/stores/-components/store-table";

const stores = [
	{
		id: "store-supermarket",
		name: "スーパーA",
		url: "https://example.com/supermarket",
		faviconUrl: null,
		createdAt: "2026-08-15T00:00:00.000Z",
		updatedAt: "2026-08-15T00:00:00.000Z",
	},
	{
		id: "store-drugstore",
		name: "ドラッグストアB",
		url: null,
		faviconUrl: null,
		createdAt: "2026-08-16T01:30:00.000Z",
		updatedAt: "2026-08-16T01:30:00.000Z",
	},
];

const meta = {
	title: "Stores/StoreTable",
	component: StoreTable,
	parameters: {
		layout: "padded",
	},
	args: {
		stores,
		onDelete: async () => undefined,
	},
} satisfies Meta<typeof StoreTable>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
	args: {
		stores: [],
	},
};
