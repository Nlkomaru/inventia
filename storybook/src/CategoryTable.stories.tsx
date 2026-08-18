import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CategoryDto } from "@/domain/category";
import { CategoryTable } from "../../app/src/routes/_app/_master/categories/-components/category-table";

const timestamps = {
	createdAt: "2026-08-15T00:00:00.000Z",
	updatedAt: "2026-08-15T00:00:00.000Z",
};

const categories: CategoryDto[] = [
	{
		id: "daily",
		name: "日用品",
		parentId: null,
		kind: "daily_goods",
		sortOrder: 10,
		...timestamps,
	},
	{
		id: "food",
		name: "食料品",
		parentId: null,
		kind: "food",
		sortOrder: 20,
		...timestamps,
	},
	{
		id: "books",
		name: "書籍",
		parentId: null,
		kind: "book",
		sortOrder: 30,
		...timestamps,
	},
];

// 種別未設定の子は祖先を遡って実効種別が決まる。展開すると「継承: 書籍」を表示する
const nestedCategories: CategoryDto[] = [
	...categories,
	{
		id: "books-technical",
		name: "技術書",
		parentId: "books",
		kind: null,
		sortOrder: 10,
		...timestamps,
	},
	{
		id: "books-technical-frontend",
		name: "フロントエンド",
		parentId: "books-technical",
		kind: null,
		sortOrder: 10,
		...timestamps,
	},
	{
		id: "food-drink",
		name: "飲料",
		parentId: "food",
		kind: null,
		sortOrder: 10,
		...timestamps,
	},
];

const meta = {
	title: "Categories/CategoryTable",
	component: CategoryTable,
	parameters: {
		layout: "padded",
	},
	args: {
		categories,
		onDelete: async () => undefined,
	},
} satisfies Meta<typeof CategoryTable>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
	args: {
		categories: [],
	},
};

export const Nested: Story = {
	args: {
		categories: nestedCategories,
	},
};

// 種別未設定の子カテゴリは、親を展開すると「継承: 書籍」を表示する
export const KindInheritance: Story = {
	args: {
		categories: [
			{
				id: "misc",
				name: "その他",
				parentId: null,
				kind: null,
				sortOrder: 10,
				...timestamps,
			},
			{
				id: "books-technical",
				name: "技術書",
				parentId: "books",
				kind: null,
				sortOrder: 20,
				...timestamps,
			},
			{
				id: "books",
				name: "書籍",
				parentId: null,
				kind: "book",
				sortOrder: 30,
				...timestamps,
			},
		],
	},
};

export const LongName: Story = {
	args: {
		categories: [
			{
				id: "long",
				name: "季節限定・数量限定の特別包装で届く輸入食料品と関連消耗品をまとめた長い名前のカテゴリ",
				parentId: null,
				kind: "food",
				sortOrder: 10,
				...timestamps,
			},
			...categories,
		],
	},
};
