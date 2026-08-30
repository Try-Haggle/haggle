import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface NavTabProps {
  href: string;
  label: ReactNode;
  active?: boolean;
  /**
   * "underline" — desktop top-nav text tab with an active underline bar.
   * "stacked"   — mobile bottom-nav icon-over-label, active = accent color.
   */
  variant?: "underline" | "stacked";
  /** Icon shown above the label in the "stacked" variant. */
  icon?: ReactNode;
  /**
   * Unread indication. `true` is a bare dot; a number renders the count on the
   * text tab (there is room for it there) and a dot on the icon tab (there is
   * not).
   */
  badge?: boolean | number;
  onClick?: () => void;
  className?: string;
}

export function NavTab({
  href,
  label,
  active = false,
  variant = "underline",
  icon,
  badge = false,
  onClick,
  className,
}: NavTabProps) {
  if (variant === "stacked") {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={cn(
          "flex flex-col items-center gap-0.5 transition-colors",
          active ? "text-action-primary" : "text-ink-muted",
          className,
        )}
      >
        <span className="relative">
          {icon}
          {Boolean(badge) && (
            <span className="-top-0.5 -right-0.5 absolute size-2 rounded-full bg-error" />
          )}
        </span>
        <span className="font-medium text-[10px]">{label}</span>
      </Link>
    );
  }
  const count = typeof badge === "number" ? badge : 0;

  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 px-3 py-1 font-medium text-ink text-sm transition-colors",
        className,
      )}
    >
      {label}
      {count > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 font-bold text-[10px] text-on-accent">
          {count > 9 ? "9+" : count}
        </span>
      )}
      {badge === true && <span className="size-1.5 rounded-full bg-error" />}
      {active && (
        <span className="absolute right-3 bottom-0 left-3 h-0.5 rounded-full bg-action-primary" />
      )}
    </Link>
  );
}
