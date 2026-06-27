"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { cn } from "@/lib/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Allow closing via backdrop click / Escape (default true). */
  dismissible?: boolean;
  children: ReactNode;
  className?: string;
}

const sizeClass = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" } as const;

export function Modal({
  open,
  onClose,
  title,
  footer,
  size = "md",
  dismissible = true,
  children,
  className,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && dismissible) onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, dismissible]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={dismissible ? onClose : undefined}
        className="absolute inset-0 bg-black/50"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          "relative w-full rounded-2xl border border-line bg-surface-raised shadow-xl",
          sizeClass[size],
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 border-line border-b px-5 py-4">
            <h2 id={titleId} className="font-semibold text-ink text-lg">
              {title}
            </h2>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 rounded p-1 text-ink-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
              >
                <X className="size-5" />
              </button>
            )}
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-line border-t px-5 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
