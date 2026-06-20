import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  key: string;
  label: ReactNode;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onValueChange?: (key: string) => void;
  variant?: "segmented" | "underline";
  /** Equal-width tabs spanning the full container. */
  fullWidth?: boolean;
  className?: string;
}

export function Tabs({
  items,
  value,
  onValueChange,
  variant = "segmented",
  fullWidth = false,
  className,
}: TabsProps) {
  // Roving keyboard nav (ArrowLeft/Right/Home/End) per the ARIA tablist pattern.
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    onValueChange?.(items[next].key);
    const buttons =
      e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  }

  const segmented = variant === "segmented";

  return (
    <div
      role="tablist"
      className={cn(
        segmented
          ? "inline-flex gap-1 rounded-lg bg-surface-sunken p-[3px]"
          : "flex gap-6 border-line border-b",
        fullWidth && "flex w-full",
        className,
      )}
    >
      {items.map((t, i) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange?.(t.key)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn(
              "font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60",
              fullWidth && "flex-1 text-center",
              segmented
                ? cn(
                    "rounded-md px-3 py-1.5",
                    active
                      ? "bg-surface-raised text-ink shadow-sm"
                      : "text-ink-secondary hover:text-ink",
                  )
                : cn(
                    "-mb-px rounded-sm border-b-2 pb-2.5",
                    active
                      ? "border-action-primary text-ink"
                      : "border-transparent text-ink-secondary hover:text-ink",
                  ),
            )}
          >
            {t.label}
            {t.count != null && <span className="ml-1.5 text-ink-muted">({t.count})</span>}
          </button>
        );
      })}
    </div>
  );
}
