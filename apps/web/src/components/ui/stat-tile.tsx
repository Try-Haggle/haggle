import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const statTileVariants = cva("rounded-xl border border-line bg-surface-raised", {
  variants: {
    size: { sm: "p-3", md: "p-4" },
    align: { left: "text-left", center: "text-center" },
  },
  defaultVariants: { size: "md", align: "left" },
});

const valueTone = {
  default: "text-ink",
  accent: "text-action-primary",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
  info: "text-info",
} as const;

export interface StatTileProps extends VariantProps<typeof statTileVariants> {
  label: ReactNode;
  value: ReactNode;
  /** Optional secondary line under the label. */
  sub?: ReactNode;
  /** Optional leading icon (KPI style), rendered in an accent chip. */
  icon?: ReactNode;
  /** Color of the value. */
  tone?: keyof typeof valueTone;
  className?: string;
}

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "default",
  size,
  align,
  className,
}: StatTileProps) {
  const big = size !== "sm";
  return (
    <div className={cn(statTileVariants({ size, align }), className)}>
      {icon && (
        <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-surface-sunken text-action-primary">
          {icon}
        </div>
      )}
      <div className={cn("font-bold tabular-nums", big ? "text-2xl" : "text-lg", valueTone[tone])}>
        {value}
      </div>
      <div className="text-ink-muted text-xs">{label}</div>
      {sub && <div className="mt-0.5 text-ink-secondary text-xs">{sub}</div>}
    </div>
  );
}
