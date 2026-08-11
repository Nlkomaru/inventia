import {
	Button as BaseButton,
	type ButtonProps as BaseButtonProps,
} from "@base-ui/react/button";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "default" | "sm" | "icon";

export interface ButtonProps extends Omit<BaseButtonProps, "className"> {
	variant?: ButtonVariant;
	size?: ButtonSize;
	className?: string;
}

const baseStyles =
	"inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold tracking-[0.01em] outline-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 select-none hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45";

const variantStyles: Record<ButtonVariant, string> = {
	primary:
		"border-slate-950 bg-slate-950 text-white shadow-[0_8px_20px_-12px_rgba(15,23,42,0.8)] hover:border-indigo-700 hover:bg-indigo-700 focus-visible:ring-indigo-600",
	secondary:
		"border-slate-200 bg-white text-slate-950 shadow-sm hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-slate-500",
	ghost:
		"border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-slate-500",
};

const sizeStyles: Record<ButtonSize, string> = {
	default: "",
	sm: "min-h-9 px-3 py-1.5 text-xs",
	icon: "size-10 p-0",
};

export function Button({
	className,
	size = "default",
	variant = "primary",
	...props
}: ButtonProps) {
	return (
		<BaseButton
			{...props}
			className={[
				baseStyles,
				variantStyles[variant],
				sizeStyles[size],
				className,
			]
				.filter(Boolean)
				.join(" ")}
		/>
	);
}
