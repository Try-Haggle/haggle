import { Check } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/cn";

export interface StepperProps {
  steps: string[];
  /** Index of the current (active) step. Earlier steps render as done. */
  current: number;
  /** When provided, step markers become buttons calling this with the step index. */
  onStepClick?: (index: number) => void;
  className?: string;
}

export function Stepper({ steps, current, onStepClick, className }: StepperProps) {
  return (
    <div className={cn("flex items-center", className)}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const markerClassName = cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full font-semibold text-xs transition-colors",
          done && "bg-action-primary text-on-accent",
          active && "bg-action-primary/15 text-action-primary ring-2 ring-action-primary/30",
          !done && !active && "bg-surface-sunken text-ink-muted",
        );
        const markerContent = done ? <Check className="size-4" /> : i + 1;
        return (
          <Fragment key={label}>
            {i > 0 && (
              <div className={cn("h-px flex-1", i <= current ? "bg-action-primary" : "bg-line")} />
            )}
            <div className="flex items-center gap-2">
              {onStepClick ? (
                <button
                  type="button"
                  onClick={() => onStepClick(i)}
                  className={cn(
                    markerClassName,
                    "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60",
                  )}
                >
                  {markerContent}
                </button>
              ) : (
                <span className={markerClassName}>{markerContent}</span>
              )}
              <span
                className={cn(
                  "hidden font-medium text-sm sm:inline",
                  active ? "text-ink" : "text-ink-muted",
                )}
              >
                {label}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
