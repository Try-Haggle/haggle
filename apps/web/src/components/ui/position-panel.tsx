import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const sideStyle = {
  buyer: { border: "border-l-info/50", label: "text-info", default: "구매자" },
  seller: { border: "border-l-badge-text/50", label: "text-badge-text", default: "판매자" },
} as const;

export interface PositionPanelProps {
  side: "buyer" | "seller";
  /** Eyebrow label (defaults to 구매자/판매자). */
  label?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Buyer-vs-seller position/claim card with a side-colored left accent. */
export function PositionPanel({ side, label, children, className }: PositionPanelProps) {
  const s = sideStyle[side];
  return (
    <div
      className={cn(
        "rounded-xl border border-line border-l-[3px] bg-surface-raised p-4",
        s.border,
        className,
      )}
    >
      <div className={cn("mb-1 font-semibold text-[11px] uppercase tracking-wide", s.label)}>
        {label ?? s.default}
      </div>
      <div className="text-ink-secondary text-sm">{children}</div>
    </div>
  );
}
