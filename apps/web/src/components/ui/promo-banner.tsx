import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PromoBannerProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "success" | "info" | "warning";
  onClose?: () => void;
  className?: string;
}

export function PromoBanner({
  title,
  description,
  action,
  icon,
  tone = "default",
  onClose,
  className,
}: PromoBannerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border px-4 py-3",
        tone === "success" && "border-success/30 bg-success-soft",
        tone === "info" && "border-info/30 bg-info-soft",
        tone === "warning" && "border-warning/30 bg-warning-soft",
        tone === "default" && "border-line bg-surface-sunken",
        className,
      )}
    >
      {icon && <span className="shrink-0 text-ink-secondary">{icon}</span>}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink text-sm">{title}</p>
        {description && <p className="text-ink-secondary text-xs">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-ink-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
