import { cn } from "../../utils";

export function Button({ className, variant = "primary", size = "md", children, ...props }) {
    const variants = {
        primary: "bg-brand-secondary text-white hover:bg-brand-secondary/90",
        secondary: "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50",
        danger: "bg-brand-danger text-white hover:bg-brand-danger/90",
        ghost: "bg-transparent hover:bg-slate-100 text-slate-600",
    };

    const sizes = {
        sm: "px-3 py-1.5 text-sm",
        md: "px-4 py-2",
        lg: "px-6 py-3 text-lg",
    };

    return (
        <button
            className={cn(
                "inline-flex items-center justify-center rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
                variants[variant],
                sizes[size],
                className
            )}
            {...props}
        >
            {children}
        </button>
    );
}
