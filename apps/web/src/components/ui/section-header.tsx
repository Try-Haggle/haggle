import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SectionHeaderProps {
  title: ReactNode;
  /** Optional count shown next to the title. */
  count?: number | string;
  /** Right-aligned action slot (link / button group). */
  action?: ReactNode;
  variant?: "section" | "eyebrow";
  className?: string;
}

export function SectionHeader({
  title,
  count,
  action,
  variant = "section",
  className,
}: SectionHeaderProps) {
  if (variant === "eyebrow") {
    return (
      <div className={cn("flex items-center justify-between gap-3", className)}>
        <span className="font-medium text-[11px] text-ink-muted uppercase tracking-wide">
          {title}
          {count != null && <span className="ml-1.5 normal-case">({count})</span>}
        </span>
        {action}
      </div>
    );
  }
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="font-semibold text-ink text-lg">
        {title}
        {count != null && (
          <span className="ml-2 font-normal text-ink-muted text-sm">({count})</span>
        )}
      </h2>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
