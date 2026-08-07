import {
	Button as AriaButton,
	type ButtonProps as AriaButtonProps,
} from "react-aria-components";

export type ButtonVariant = "primary" | "secondary";

export interface ButtonProps extends AriaButtonProps {
	variant?: ButtonVariant;
}

const baseStyles =
	"inline-flex min-h-11 items-center justify-center rounded-full border px-5 py-2.5 text-sm font-semibold tracking-[0.01em] outline-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 select-none data-[pressed]:translate-y-px data-[focus-visible]:ring-2 data-[focus-visible]:ring-offset-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

const variantStyles: Record<ButtonVariant, string> = {
	primary:
		"border-slate-950 bg-slate-950 text-white shadow-sm data-[hovered]:border-indigo-700 data-[hovered]:bg-indigo-700 data-[focus-visible]:ring-indigo-600",
	secondary:
		"border-slate-300 bg-white text-slate-950 shadow-sm data-[hovered]:border-slate-500 data-[hovered]:bg-slate-50 data-[focus-visible]:ring-slate-500",
};

export function Button({
	className,
	variant = "primary",
	...props
}: ButtonProps) {
	return (
		<AriaButton
			{...props}
			className={(renderProps) =>
				[
					baseStyles,
					variantStyles[variant],
					typeof className === "function" ? className(renderProps) : className,
				]
					.filter(Boolean)
					.join(" ")
			}
		/>
	);
}
