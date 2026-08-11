import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../../app/src/components/ui/button";

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
			options: ["default", "secondary", "ghost", "outline", "destructive"],
		},
	},
	args: {
		children: "実行する",
	},
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		variant: "default",
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
