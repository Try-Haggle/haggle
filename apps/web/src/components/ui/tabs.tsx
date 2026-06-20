"use client";

import { type KeyboardEvent, type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  key: string;
  label: ReactNode;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  /** Controlled active key. Omit for uncontrolled (see `defaultValue`). */
  value?: string;
  /** Initial active key when uncontrolled. Defaults to the first item. */
  defaultValue?: string;
  onValueChange?: (key: string) => void;
  variant?: "segmented" | "underline";
  /** Equal-width tabs spanning the full container. */
  fullWidth?: boolean;
  className?: string;
}

export function Tabs({
  items,
  value: valueProp,
  defaultValue,
  onValueChange,
  variant = "segmented",
  fullWidth = false,
  className,
}: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.key);
  const value = valueProp ?? internalValue;

  function selectTab(key: string) {
    if (valueProp === undefined) setInternalValue(key);
    onValueChange?.(key);
  }

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
    selectTab(items[next].key);
    const buttons =
      e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  }

  const segmented = variant === "segmented";

  return (
    <div
      role="tablist"
      className={cn(
        "overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]",
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
            onClick={() => selectTab(t.key)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn(
              "min-h-10 shrink-0 whitespace-nowrap font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60",
              fullWidth && "flex-1 text-center",
              segmented
                ? cn(
                    "rounded-md px-3 py-2",
                    active
                      ? "bg-surface-raised text-ink shadow-sm"
                      : "text-ink-secondary hover:text-ink",
                  )
                : cn(
                    "-mb-px rounded-sm border-b-2 py-2",
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
