import { cn } from "../../utils";

export function Card({ className, children, ...props }) {
    return (
        <div
            className={cn(
                "glass-card rounded-2xl overflow-hidden",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}

export function CardHeader({ className, children, ...props }) {
    return (
        <div className={cn("px-6 py-4 border-b border-slate-100", className)} {...props}>
            {children}
        </div>
    );
}

export function CardContent({ className, children, ...props }) {
    return (
        <div className={cn("p-6", className)} {...props}>
            {children}
        </div>
    );
}
