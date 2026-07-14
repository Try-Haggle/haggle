import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const cardVariants = cva("", {
  variants: {
    tone: {
      default: "border border-line bg-surface-raised text-ink shadow-card",
      sunken: "border border-line bg-surface-sunken text-ink",
      danger: "border border-error/30 bg-error-soft text-ink",
      premium: "bg-premium text-on-accent shadow-card",
    },
    padding: {
      none: "p-0",
      sm: "p-4",
      md: "p-7",
      lg: "p-8",
    },
    radius: {
      lg: "rounded-xl",
      xl: "rounded-2xl",
    },
  },
  defaultVariants: { tone: "default", padding: "md", radius: "xl" },
});

export type CardProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardVariants> & { as?: "div" | "section" };

export function Card({ className, tone, padding, radius, as: Tag = "div", ...props }: CardProps) {
  return <Tag className={cn(cardVariants({ tone, padding, radius }), className)} {...props} />;
}

export interface CardHeaderProps {
  /** Leading icon (rendered in the accent color). */
  icon?: ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: string;
  title: ReactNode;
  /** Right-aligned action/meta slot. */
  action?: ReactNode;
  className?: string;
}

/** Standard section-card header: icon + (eyebrow) + title on the left, action on the right. */
export function CardHeader({ icon, eyebrow, title, action, className }: CardHeaderProps) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="flex items-center gap-2.5">
        {icon && <span className="shrink-0 text-action-primary">{icon}</span>}
        <div>
          {eyebrow && (
            <div className="font-medium text-[11px] text-ink-muted uppercase tracking-wide">
              {eyebrow}
            </div>
          )}
          <h3 className="font-semibold text-ink">{title}</h3>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
