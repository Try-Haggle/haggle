import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ListRowProps {
  /** Leading visual — thumbnail, icon, avatar. */
  leading?: ReactNode;
  title: ReactNode;
  /** Secondary line (e.g. dot-separated meta). */
  meta?: ReactNode;
  /** Inline badges rendered next to the title. */
  badges?: ReactNode;
  /** Right-aligned content (price, time, status). */
  trailing?: ReactNode;
  /** Render as a Next link. */
  href?: string;
  onClick?: () => void;
  showChevron?: boolean;
  /** Accent + tinted background for a selected/active row. */
  active?: boolean;
  className?: string;
}

export function ListRow({
  leading,
  title,
  meta,
  badges,
  trailing,
  href,
  onClick,
  showChevron,
  active = false,
  className,
}: ListRowProps) {
  const classes = cn(
    "group flex items-center gap-3 rounded-xl border p-4 text-left transition-colors",
    active
      ? "border-action-primary/30 bg-action-primary/5"
      : "border-line bg-surface-raised hover:border-line-strong",
    className,
  );

  const inner = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-ink">{title}</span>
          {badges}
        </div>
        {meta && <div className="mt-0.5 text-ink-muted text-xs">{meta}</div>}
      </div>
      {trailing && <div className="shrink-0 text-right">{trailing}</div>}
      {showChevron && (
        <ChevronRight className="size-4 shrink-0 text-ink-muted transition-colors group-hover:text-ink" />
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(classes, "w-full")}>
        {inner}
      </button>
    );
  }
  return <div className={classes}>{inner}</div>;
}
