import type { DisputeStatus } from "./types.js";

type DisputeEvent =
  | "review"
  | "request_buyer_evidence"
  | "request_seller_evidence"
  | "resolve_buyer_favor"
  | "resolve_seller_favor"
  | "resolve_partial_refund"
  | "close";

const DISPUTE_TRANSITIONS: Record<DisputeStatus, Partial<Record<DisputeEvent, DisputeStatus>>> = {
  OPEN: {
    review: "UNDER_REVIEW",
    request_buyer_evidence: "WAITING_FOR_BUYER",
    request_seller_evidence: "WAITING_FOR_SELLER",
  },
  UNDER_REVIEW: {
    request_buyer_evidence: "WAITING_FOR_BUYER",
    request_seller_evidence: "WAITING_FOR_SELLER",
    resolve_buyer_favor: "RESOLVED_BUYER_FAVOR",
    resolve_seller_favor: "RESOLVED_SELLER_FAVOR",
    resolve_partial_refund: "PARTIAL_REFUND",
  },
  WAITING_FOR_BUYER: {
    review: "UNDER_REVIEW",
    close: "CLOSED",
  },
  WAITING_FOR_SELLER: {
    review: "UNDER_REVIEW",
    close: "CLOSED",
  },
  RESOLVED_BUYER_FAVOR: { close: "CLOSED" },
  RESOLVED_SELLER_FAVOR: { close: "CLOSED" },
  PARTIAL_REFUND: { close: "CLOSED" },
  CLOSED: {},
};

export function transitionDisputeStatus(
  status: DisputeStatus,
  event: DisputeEvent,
): DisputeStatus | null {
  return DISPUTE_TRANSITIONS[status][event] ?? null;
}
