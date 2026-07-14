"use client";

import { Check, Copy } from "lucide-react";
import { forwardRef, type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";

export interface CopyButtonProps {
  value: string;
  label?: ReactNode;
  size?: "sm" | "md";
  disabled?: boolean;
  onCopy?: () => void;
  className?: string;
}

export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(function CopyButton(
  { value, label, size = "md", disabled = false, onCopy, className },
  ref,
) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  };

  return (
    <button
      ref={ref}
      type="button"
      onClick={copy}
      disabled={disabled}
      aria-label={copied ? "Copied" : "Copy"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-line text-ink-secondary transition hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-sm",
        className,
      )}
    >
      {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      {label}
    </button>
  );
});
