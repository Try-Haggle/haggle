import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-[0.02em]",
  {
    variants: {
      tone: {
        gold: "bg-badge text-badge-text",
        success: "bg-success-soft text-success",
        info: "bg-info-soft text-info",
        warning: "bg-warning-soft text-warning",
        error: "bg-error-soft text-error",
        neutral: "bg-surface-sunken text-ink-secondary",
      },
    },
    defaultVariants: { tone: "gold" },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & { dot?: boolean };

export function Badge({ className, tone, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
