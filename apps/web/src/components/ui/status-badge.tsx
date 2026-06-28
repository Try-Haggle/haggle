import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Bordered soft status pill backed by a per-domain registry.
 *
 * The same status string can mean different things across domains — e.g. `OPEN`
 * is an error in the order/payment lifecycle but a (benign) warning for a fresh
 * dispute, and `UNDER_REVIEW` is a warning for orders but informational for
 * disputes. Keep the maps split by `domain` so a status never picks up the wrong
 * tone. To add a domain, extend `REGISTRY`.
 */
export type StatusTone = "success" | "info" | "warning" | "error" | "neutral" | "gold";

export type StatusDomain = "order" | "dispute";

const toneClass: Record<StatusTone, string> = {
  success: "bg-success-soft text-success border-success/30",
  info: "bg-info-soft text-info border-info/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  error: "bg-error-soft text-error border-error/30",
  neutral: "bg-surface-sunken text-ink-secondary border-line",
  gold: "bg-badge text-badge-text border-badge-text/30",
};

interface StatusEntry {
  tone: StatusTone;
  /** Friendly label; when omitted the status is humanized (`_`→space). */
  label?: string;
}

/** Order lifecycle + payment + shipment statuses (orders list & detail). */
const ORDER_STATUS: Record<string, StatusEntry> = {
  APPROVED: { tone: "info" },
  PAYMENT_PENDING: { tone: "warning" },
  PAID: { tone: "success" },
  FULFILLMENT_PENDING: { tone: "warning" },
  FULFILLMENT_ACTIVE: { tone: "info" },
  DELIVERED: { tone: "success" },
  IN_DISPUTE: { tone: "error" },
  REFUNDED: { tone: "info" },
  CLOSED: { tone: "neutral" },
  CANCELED: { tone: "neutral" },
  // payment / shipment lifecycle (order detail)
  CREATED: { tone: "neutral" },
  QUOTED: { tone: "info" },
  AUTHORIZED: { tone: "info" },
  SETTLEMENT_PENDING: { tone: "info" },
  SETTLED: { tone: "success" },
  IN_TRANSIT: { tone: "info" },
  LABEL_PENDING: { tone: "neutral" },
  LABEL_CREATED: { tone: "info" },
  OUT_FOR_DELIVERY: { tone: "info" },
  DELIVERY_EXCEPTION: { tone: "error" },
  OPEN: { tone: "error" },
  UNDER_REVIEW: { tone: "warning" },
  FAILED: { tone: "error" },
};

/** Dispute lifecycle statuses (disputes list & detail). Friendly labels shared. */
const DISPUTE_STATUS: Record<string, StatusEntry> = {
  OPEN: { tone: "warning", label: "Open" },
  UNDER_REVIEW: { tone: "info", label: "Under Review" },
  WAITING_FOR_BUYER: { tone: "info", label: "Awaiting Buyer Evidence" },
  WAITING_FOR_SELLER: { tone: "info", label: "Awaiting Seller Evidence" },
  ESCALATED: { tone: "warning", label: "Escalated" },
  RESOLVED_BUYER_FAVOR: { tone: "success", label: "Resolved — Buyer Favor" },
  RESOLVED_SELLER_FAVOR: { tone: "success", label: "Resolved — Seller Favor" },
  PARTIAL_REFUND: { tone: "info", label: "Partial Refund" },
  CLOSED: { tone: "neutral", label: "Closed" },
};

const REGISTRY: Record<StatusDomain, Record<string, StatusEntry>> = {
  order: ORDER_STATUS,
  dispute: DISPUTE_STATUS,
};

export interface StatusBadgeProps {
  domain: StatusDomain;
  status: string;
  /** Override the registry/humanized label. */
  label?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

export function StatusBadge({ domain, status, label, size = "md", className }: StatusBadgeProps) {
  const entry = REGISTRY[domain][status];
  const tone = entry?.tone ?? "neutral";
  const resolved = label ?? entry?.label ?? status.replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs",
        toneClass[tone],
        className,
      )}
    >
      {resolved}
    </span>
  );
}
