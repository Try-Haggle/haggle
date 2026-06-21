import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const emptyStateVariants = cva("flex flex-col items-center justify-center text-center", {
  variants: {
    bordered: { true: "rounded-xl border border-line", false: "" },
    dashed: { true: "border-dashed", false: "" },
    padding: { none: "p-0", sm: "p-8", md: "p-12", lg: "p-16" },
    /** Content scale: icon chip + gap + title size. */
    size: { sm: "gap-1.5", md: "gap-2" },
  },
  defaultVariants: { bordered: true, dashed: false, padding: "md", size: "md" },
});

export interface EmptyStateProps extends VariantProps<typeof emptyStateVariants> {
  /** Icon or emoji shown in a circular chip. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** CTA slot rendered below the text. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  bordered,
  dashed,
  padding,
  size,
  className,
}: EmptyStateProps) {
  const sm = size === "sm";
  return (
    <div className={cn(emptyStateVariants({ bordered, dashed, padding, size }), className)}>
      {icon && (
        <div
          className={cn(
            // dark: sunken (navy-950) is darker than the page, so it reads as a black
            // hole — use raised (navy-800, lighter) so the chip stays visible.
            "flex items-center justify-center rounded-full bg-surface-sunken text-ink-muted dark:bg-surface-raised",
            sm ? "size-10" : "size-12",
          )}
        >
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className={cn("font-semibold text-ink", sm && "text-sm")}>{title}</p>
        {description && <p className="text-ink-muted text-sm">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
