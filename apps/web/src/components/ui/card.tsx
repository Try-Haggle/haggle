import { cva, type VariantProps } from "class-variance-authority";
import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const cardVariants = cva("", {
  variants: {
    tone: {
      // White on the cream page, a faint border, and the soft card shadow —
      // the shadow does the separating, so the border can stay quiet.
      default: "border border-line-subtle bg-surface-overlay text-ink shadow-card",
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
    /**
     * The whole card is the click target. Put the card's one link inside with
     * `cardLinkClass` — its ::after stretches over the card, so there is a
     * single link (not a link wrapping a button) and text stays selectable.
     */
    interactive: {
      true: "relative cursor-pointer transition-[box-shadow,transform] duration-200 ease-standard hover:-translate-y-0.5 hover:shadow-card-hover has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus/60 motion-reduce:hover:translate-y-0",
    },
  },
  defaultVariants: { tone: "default", padding: "md", radius: "xl" },
});

/** For the one link inside an `interactive` card: makes the whole card clickable. */
// Two things would shrink the ::after back onto the link itself, because a
// positioned or transformed element becomes the box its ::after fills:
// - `static`: a link styled as a button is `relative`;
// - no press nudge: the button's active state sets CSS `translate`, and any
//   value but `none` (even 0) does the same, so the cover collapsed mid-click
//   and a press on the card body missed the link. Hence translate-none, with
//   `!` so it beats the button's own active rule regardless of CSS order.
export const cardLinkClass =
  "static not-disabled:active:translate-none! focus-visible:outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']";

export type CardProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardVariants> & { as?: "div" | "section" | "li" | "article" };

export function Card({
  className,
  tone,
  padding,
  radius,
  interactive,
  as = "div",
  ...props
}: CardProps) {
  // The element varies (div/section/li/article); its props are the shared HTML set.
  const Tag = as as ElementType;
  return (
    <Tag
      className={cn(cardVariants({ tone, padding, radius, interactive }), className)}
      {...props}
    />
  );
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
