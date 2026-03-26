import type { SettlementApproval, SellerApprovalMode } from "@haggle/commerce-core";
import type { PaymentRail } from "./types.js";

export interface PaymentExecutionActor {
  actor_id: string;
  actor_role: "buyer" | "seller";
}

export interface PaymentExecutionSnapshot {
  settlement_approval_id: string;
  listing_id: string;
  seller_id: string;
  buyer_id: string;
  amount_minor: number;
  currency: string;
  selected_rail: PaymentRail;
  actor: PaymentExecutionActor;
}

function ensureApprovalTimeline(approval: SettlementApproval, mode: SellerApprovalMode) {
  if (!approval.buyer_approved_at) {
    throw new Error("buyer approval is required before payment execution");
  }

  if (mode === "MANUAL_CONFIRMATION" && !approval.seller_approved_at) {
    throw new Error("seller approval is required before payment execution");
  }
}

export function assertActorInSettlementApproval(
  approval: SettlementApproval,
  actor: PaymentExecutionActor,
): void {
  const matchesBuyer = actor.actor_role === "buyer" && actor.actor_id === approval.terms.buyer_id;
  const matchesSeller = actor.actor_role === "seller" && actor.actor_id === approval.terms.seller_id;

  if (!matchesBuyer && !matchesSeller) {
    throw new Error("actor is not a participant in this settlement approval");
  }
}

export function assertPaymentReadyForExecution(
  approval: SettlementApproval,
  actor: PaymentExecutionActor,
): PaymentExecutionSnapshot {
  assertActorInSettlementApproval(approval, actor);

  if (approval.approval_state !== "APPROVED") {
    throw new Error(`payment execution requires APPROVED settlement, got ${approval.approval_state}`);
  }

  ensureApprovalTimeline(approval, approval.seller_policy.mode);

  if (!approval.terms.selected_payment_rail) {
    throw new Error("selected payment rail is missing");
  }

  if (!approval.terms.currency) {
    throw new Error("currency is missing");
  }

  if (approval.terms.final_amount_minor <= 0) {
    throw new Error("final amount must be positive");
  }

  return {
    settlement_approval_id: approval.id,
    listing_id: approval.terms.listing_id,
    seller_id: approval.terms.seller_id,
    buyer_id: approval.terms.buyer_id,
    amount_minor: approval.terms.final_amount_minor,
    currency: approval.terms.currency,
    selected_rail: approval.terms.selected_payment_rail,
    actor,
  };
}
