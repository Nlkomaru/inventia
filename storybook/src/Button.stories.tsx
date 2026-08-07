import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../../app/src/components/Button";

const meta = {
	title: "Components/Button",
	component: Button,
	parameters: {
		docs: {
			description: {
				component:
					"A React Aria button with keyboard, focus, press, and disabled behavior provided by the platform-aware interaction model.",
			},
		},
	},
	argTypes: {
		variant: {
			control: "inline-radio",
			options: ["primary", "secondary"],
		},
	},
	args: {
		children: "Create project",
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
		isDisabled: true,
		variant: "primary",
	},
};
