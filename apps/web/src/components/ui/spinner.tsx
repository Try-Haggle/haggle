import { cn } from "@/lib/cn";

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  /** Accessible label (defaults to "Loading"). */
  label?: string;
  className?: string;
}

const sizes = { sm: "size-4 border-2", md: "size-6 border-2", lg: "size-8 border-[3px]" } as const;

/** Inherits color via `currentColor` — set text-* on the element or a parent. */
export function Spinner({ size = "md", label = "Loading", className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-block animate-spin rounded-full border-current border-t-transparent",
        sizes[size],
        className,
      )}
    />
  );
}
