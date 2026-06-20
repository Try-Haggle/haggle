import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ActivityEvent {
  id: string;
  label: ReactNode;
  time?: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "success" | "warning" | "error" | "info";
}

const dotTone = {
  default: "bg-ink-muted",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  info: "bg-info",
} as const;

export interface ActivityFeedProps {
  events: ActivityEvent[];
  className?: string;
}

export function ActivityFeed({ events, className }: ActivityFeedProps) {
  return (
    <ol className={className}>
      {events.map((e, i) => {
        const last = i === events.length - 1;
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && (
              <span
                aria-hidden="true"
                className="absolute top-3.5 left-[5px] h-full w-px bg-line"
              />
            )}
            <span
              className={cn(
                "relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full",
                dotTone[e.tone ?? "default"],
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-ink text-sm">{e.label}</span>
                {e.time && <span className="shrink-0 text-ink-muted text-xs">{e.time}</span>}
              </div>
              {e.detail && <p className="mt-0.5 text-ink-muted text-xs">{e.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
