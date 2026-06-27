"use client";

import { Check } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Popover, type PopoverProps, usePopoverClose } from "./popover";

export type DropdownMenuProps = Pick<
  PopoverProps,
  "trigger" | "align" | "side" | "open" | "defaultOpen" | "onOpenChange" | "className"
> & { children: ReactNode };

function handleMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return;

  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  if (items.length === 0) return;

  e.preventDefault();
  const currentIndex = items.indexOf(document.activeElement as HTMLElement);

  let nextIndex: number;
  switch (e.key) {
    case "ArrowDown":
      nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      break;
    case "ArrowUp":
      nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      break;
    case "Home":
      nextIndex = 0;
      break;
    default:
      nextIndex = items.length - 1;
      break;
  }

  items[nextIndex]?.focus();
}

export function DropdownMenu({ children, ...props }: DropdownMenuProps) {
  return (
    <Popover {...props} panelClassName="min-w-[12rem] p-1">
      <div role="menu" onKeyDown={handleMenuKeyDown}>
        {children}
      </div>
    </Popover>
  );
}

export interface DropdownMenuItemProps {
  onSelect?: () => void;
  icon?: ReactNode;
  destructive?: boolean;
  /** Marks the current choice — shows a trailing check and emphasizes the label. */
  selected?: boolean;
  children: ReactNode;
}

/** Closes the parent menu automatically after selection. */
export function DropdownMenuItem({
  onSelect,
  icon,
  destructive,
  selected,
  children,
}: DropdownMenuItemProps) {
  const close = usePopoverClose();
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={selected || undefined}
      onClick={() => {
        onSelect?.();
        close();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60",
        destructive
          ? "text-error hover:bg-error-soft"
          : selected
            ? "font-medium text-ink hover:bg-surface-sunken"
            : "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {selected && <Check className="size-4 shrink-0 text-action-primary" aria-hidden="true" />}
    </button>
  );
}

export function DropdownMenuSeparator() {
  return <div className="my-1 h-px bg-line" />;
}
