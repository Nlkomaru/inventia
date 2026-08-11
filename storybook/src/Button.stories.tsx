import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../../app/src/components/Button";

const meta = {
	title: "Components/Button",
	component: Button,
	parameters: {
		docs: {
			description: {
				component:
					"A shadcn-style button built on Base UI primitives with keyboard, focus, and disabled behavior.",
			},
		},
	},
	argTypes: {
		variant: {
			control: "inline-radio",
			options: ["primary", "secondary", "ghost"],
		},
	},
	args: {
		children: "実行する",
	},
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
	args: {
		variant: "primary",
	},
};

export const Secondary: Story = {
	args: {
		children: "View documentation",
		variant: "secondary",
	},
};

export const Disabled: Story = {
	args: {
		children: "Project created",
		disabled: true,
	},
};
