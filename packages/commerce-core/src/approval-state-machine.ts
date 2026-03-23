import type { ApprovalState, SellerApprovalMode } from "./approval-policy.js";

type ApprovalEvent =
  | "reach_candidate"
  | "mark_mutually_acceptable"
  | "buyer_approve"
  | "buyer_hold"
  | "seller_reserve"
  | "resume_negotiation"
  | "seller_approve"
  | "decline"
  | "expire";

function transitionsForMode(mode: SellerApprovalMode): Record<ApprovalState, Partial<Record<ApprovalEvent, ApprovalState>>> {
  if (mode === "AUTO_WITHIN_POLICY") {
    return {
      NEGOTIATING: {
        reach_candidate: "MUTUALLY_ACCEPTABLE",
        mark_mutually_acceptable: "MUTUALLY_ACCEPTABLE",
        decline: "DECLINED",
        expire: "EXPIRED",
      },
      MUTUALLY_ACCEPTABLE: {
        buyer_approve: "APPROVED",
        buyer_hold: "HELD_BY_BUYER",
        seller_reserve: "RESERVED_PENDING_APPROVAL",
        decline: "DECLINED",
        expire: "EXPIRED",
      },
      AWAITING_BUYER_APPROVAL: { buyer_approve: "APPROVED", decline: "DECLINED", expire: "EXPIRED" },
      HELD_BY_BUYER: { resume_negotiation: "NEGOTIATING", buyer_approve: "APPROVED", decline: "DECLINED", expire: "EXPIRED" },
      RESERVED_PENDING_APPROVAL: {
        buyer_approve: "APPROVED",
        resume_negotiation: "NEGOTIATING",
        decline: "DECLINED",
        expire: "EXPIRED",
      },
      AWAITING_SELLER_APPROVAL: {},
      APPROVED: {},
      DECLINED: {},
      EXPIRED: {},
    };
  }

  return {
    NEGOTIATING: {
      reach_candidate: "MUTUALLY_ACCEPTABLE",
      mark_mutually_acceptable: "MUTUALLY_ACCEPTABLE",
      decline: "DECLINED",
      expire: "EXPIRED",
    },
    MUTUALLY_ACCEPTABLE: {
      buyer_approve: "AWAITING_SELLER_APPROVAL",
      buyer_hold: "HELD_BY_BUYER",
      seller_reserve: "RESERVED_PENDING_APPROVAL",
      decline: "DECLINED",
      expire: "EXPIRED",
    },
    AWAITING_BUYER_APPROVAL: { buyer_approve: "AWAITING_SELLER_APPROVAL", decline: "DECLINED", expire: "EXPIRED" },
    HELD_BY_BUYER: {
      resume_negotiation: "NEGOTIATING",
      buyer_approve: "AWAITING_SELLER_APPROVAL",
      decline: "DECLINED",
      expire: "EXPIRED",
    },
    RESERVED_PENDING_APPROVAL: {
      buyer_approve: "AWAITING_SELLER_APPROVAL",
      resume_negotiation: "NEGOTIATING",
      decline: "DECLINED",
      expire: "EXPIRED",
    },
    AWAITING_SELLER_APPROVAL: { seller_approve: "APPROVED", decline: "DECLINED", expire: "EXPIRED" },
    APPROVED: {},
    DECLINED: {},
    EXPIRED: {},
  };
}

export function transitionApprovalState(
  mode: SellerApprovalMode,
  status: ApprovalState,
  event: ApprovalEvent,
): ApprovalState | null {
  return transitionsForMode(mode)[status][event] ?? null;
}
