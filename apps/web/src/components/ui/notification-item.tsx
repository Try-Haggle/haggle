import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface NotificationItemProps {
  title: ReactNode;
  time?: ReactNode;
  read?: boolean;
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
  className?: string;
}

export function NotificationItem({
  title,
  time,
  read = false,
  href,
  onClick,
  icon,
  className,
}: NotificationItemProps) {
  const classes = cn(
    "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60",
    read
      ? "border-line bg-surface-raised hover:border-line-strong"
      : "border-action-primary/20 bg-action-primary/5",
    className,
  );

  const inner = (
    <>
      {icon ? (
        <span className="mt-0.5 shrink-0 text-ink-muted">{icon}</span>
      ) : (
        !read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-action-primary" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", read ? "text-ink-secondary" : "font-medium text-ink")}>
          {title}
        </p>
        {time && <p className="mt-0.5 text-ink-muted text-xs">{time}</p>}
      </div>
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
      <button type="button" onClick={onClick} className={classes}>
        {inner}
      </button>
    );
  }
  return <div className={classes}>{inner}</div>;
}
