import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SelectableOptionCardProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
};

/** Large selectable card-button (payment method, plan, agent preset…). */
export const SelectableOptionCard = forwardRef<HTMLButtonElement, SelectableOptionCardProps>(
  ({ className, selected = false, icon, title, description, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60",
        selected
          ? "border-action-primary bg-action-primary/5"
          : "border-line hover:border-line-strong",
        className,
      )}
      {...props}
    >
      {icon && <span className="mt-0.5 shrink-0 text-action-primary">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink text-sm">{title}</div>
        {description && <div className="mt-0.5 text-ink-secondary text-xs">{description}</div>}
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0 rounded-full border-2 transition-colors",
          selected ? "border-[5px] border-action-primary" : "border-line",
        )}
      />
    </button>
  ),
);
SelectableOptionCard.displayName = "SelectableOptionCard";
