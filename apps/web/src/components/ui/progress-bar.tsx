import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ProgressBarProps {
  /** 0–100. */
  value: number;
  /** Fixed tone, or "threshold" to color by value (>=70 success / >=40 warning / else error). */
  tone?: "accent" | "success" | "warning" | "error" | "info" | "threshold";
  size?: "sm" | "md";
  /** Optional label shown in a row above the bar. */
  label?: ReactNode;
  showValue?: boolean;
  className?: string;
}

const toneClass = {
  accent: "bg-action-primary",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  info: "bg-info",
} as const;

function resolveTone(tone: NonNullable<ProgressBarProps["tone"]>, value: number) {
  if (tone === "threshold") {
    return value >= 70 ? toneClass.success : value >= 40 ? toneClass.warning : toneClass.error;
  }
  return toneClass[tone];
}

export function ProgressBar({
  value,
  tone = "accent",
  size = "md",
  label,
  showValue = false,
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          {label && <span className="text-ink-secondary">{label}</span>}
          {showValue && <span className="text-ink-muted tabular-nums">{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        className={cn(
          "w-full overflow-hidden rounded-full bg-line",
          size === "sm" ? "h-1.5" : "h-2",
        )}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-all", resolveTone(tone, pct))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
