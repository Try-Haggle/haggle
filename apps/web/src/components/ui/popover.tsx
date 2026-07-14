"use client";

import {
  cloneElement,
  createContext,
  isValidElement,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useClickOutside } from "@/hooks/use-click-outside";
import { cn } from "@/lib/cn";

const PopoverContext = createContext<{ close: () => void }>({ close: () => {} });
export const usePopoverClose = () => useContext(PopoverContext).close;

type TriggerProps = {
  onClick?: MouseEventHandler;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: boolean;
};

export interface PopoverProps {
  /** The clickable element that toggles the popover. */
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "left" | "right";
  side?: "bottom" | "top";
  panelClassName?: string;
  className?: string;
}

export function Popover({
  trigger,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  align = "left",
  side = "bottom",
  panelClassName,
  className,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp ?? internalOpen;
  const ref = useRef<HTMLDivElement>(null);

  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };

  useClickOutside(ref, () => setOpen(false), open);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setOpen is recreated each render; gating on `open` is intended
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const triggerEl = isValidElement<TriggerProps>(trigger) ? (
    cloneElement(trigger, {
      onClick: (e: MouseEvent) => {
        trigger.props.onClick?.(e);
        setOpen(!open);
      },
      "aria-expanded": open,
      "aria-haspopup": true,
    })
  ) : (
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup>
      {trigger}
    </button>
  );

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      {triggerEl}
      {open && (
        <PopoverContext.Provider value={{ close: () => setOpen(false) }}>
          <div
            className={cn(
              "absolute z-50 max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-surface-raised p-2 shadow-card",
              side === "top" ? "bottom-full mb-2" : "top-full mt-2",
              align === "right" ? "right-0" : "left-0",
              panelClassName,
            )}
          >
            {children}
          </div>
        </PopoverContext.Provider>
      )}
    </div>
  );
}
