"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";

export interface DisclosureProps {
  title: ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state. Omit for uncontrolled (see `defaultOpen`). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

export function Disclosure({
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  children,
  className,
}: DisclosureProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp ?? internalOpen;

  function toggle() {
    const next = !open;
    setInternalOpen(next);
    onOpenChange?.(next);
  }

  return (
    <div className={cn("rounded-xl border border-line", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-medium text-ink text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
      >
        {title}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-ink-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-line border-t px-4 py-3 text-ink-secondary text-sm">{children}</div>
      )}
    </div>
  );
}
