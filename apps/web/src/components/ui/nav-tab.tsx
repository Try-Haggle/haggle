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
  /** Show an unread dot on the icon corner (stacked). */
  badge?: boolean;
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
          {badge && <span className="-top-0.5 -right-0.5 absolute size-2 rounded-full bg-error" />}
        </span>
        <span className="font-medium text-[10px]">{label}</span>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn("relative px-3 py-1 font-medium text-ink text-sm transition-colors", className)}
    >
      {label}
      {active && (
        <span className="absolute right-3 bottom-0 left-3 h-0.5 rounded-full bg-action-primary" />
      )}
    </Link>
  );
}
