import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../app/src/components/ui/select";

const parentOptions = [
	{ label: "最上位", value: null },
	{ label: "第1倉庫", value: "warehouse-1" },
	{ label: "第2倉庫", value: "warehouse-2" },
];

const meta = {
	title: "Components/Select",
	parameters: {
		docs: {
			description: {
				component:
					"A shadcn Select built on Base UI with keyboard navigation and a styled popup.",
			},
		},
	},
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const renderSelect = (defaultValue: string | null) => (
	<label className="flex w-64 flex-col gap-1.5 text-xs font-semibold">
		親階層
		<Select items={parentOptions} defaultValue={defaultValue}>
			<SelectTrigger className="w-full">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{parentOptions.map((option) => (
						<SelectItem key={option.value ?? "root"} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	</label>
);

export const RootSelected: Story = {
	render: () => renderSelect(null),
};

export const LocationSelected: Story = {
	render: () => renderSelect("warehouse-1"),
};
