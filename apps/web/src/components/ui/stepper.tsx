import { Check } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/cn";

export interface StepperProps {
  steps: string[];
  /** Index of the current (active) step. Earlier steps render as done. */
  current: number;
  className?: string;
}

export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <div className={cn("flex items-center", className)}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <Fragment key={label}>
            {i > 0 && (
              <div className={cn("h-px flex-1", i <= current ? "bg-action-primary" : "bg-line")} />
            )}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full font-semibold text-xs transition-colors",
                  done && "bg-action-primary text-on-accent",
                  active &&
                    "bg-action-primary/15 text-action-primary ring-2 ring-action-primary/30",
                  !done && !active && "bg-surface-sunken text-ink-muted",
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
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
