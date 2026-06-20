import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { BackLink } from "./back-link";

export interface PageHeaderProps {
  /** Leading accent icon. */
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Renders a back link above the title. */
  backHref?: string;
  backLabel?: string;
  /** Right-aligned actions slot. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  icon,
  title,
  subtitle,
  backHref,
  backLabel = "Back",
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      {backHref && (
        <BackLink href={backHref} className="mb-3">
          {backLabel}
        </BackLink>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {icon && <span className="shrink-0 text-action-primary">{icon}</span>}
          <div>
            <h1 className="font-bold text-2xl text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-ink-secondary text-sm">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
