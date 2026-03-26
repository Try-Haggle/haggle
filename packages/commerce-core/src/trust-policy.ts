import type { SettlementReliabilitySnapshot, TrustPenaltyReason } from "./trust-ledger.js";

export type TrustSourceModule = "payment" | "shipping" | "dispute";

export type TrustTriggerType =
  | "buyer_approved_but_not_paid"
  | "seller_approved_but_not_fulfilled"
  | "shipment_input_sla_missed"
  | "dispute_loss"
  | "dispute_win"
  | "successful_settlement";

export interface TrustTriggerEvent {
  module: TrustSourceModule;
  actor_role: "buyer" | "seller";
  type: TrustTriggerType;
}

export function resolveTrustPenaltyReason(event: TrustTriggerEvent): TrustPenaltyReason | null {
  switch (event.type) {
    case "buyer_approved_but_not_paid":
      return "BUYER_APPROVED_BUT_NOT_PAID";
    case "seller_approved_but_not_fulfilled":
      return "SELLER_APPROVED_BUT_NOT_FULFILLED";
    case "shipment_input_sla_missed":
      return "SHIPMENT_INFO_SLA_MISSED";
    case "dispute_loss":
      return "DISPUTE_LOSS";
    default:
      return null;
  }
}

export function trustPenaltyScore(reason: TrustPenaltyReason): number {
  switch (reason) {
    case "BUYER_APPROVED_BUT_NOT_PAID":
      return 0.35;
    case "SELLER_APPROVED_BUT_NOT_FULFILLED":
      return 0.4;
    case "SHIPMENT_INFO_SLA_MISSED":
      return 0.2;
    case "DISPUTE_LOSS":
      return 0.3;
  }
}

/**
 * Normalize long-term fulfillment reliability into [0,1].
 * Defaults and SLA misses are weighted more heavily than ordinary disputes.
 */
export function computeSettlementReliability(snapshot: Omit<SettlementReliabilitySnapshot, "settlement_reliability">): number {
  const success = snapshot.successful_settlements;
  const defaults = snapshot.approval_defaults * 1.5;
  const slaMisses = snapshot.shipment_sla_misses * 1.0;
  const disputeLosses = snapshot.dispute_losses * 1.2;
  const disputeWinsCredit = snapshot.dispute_wins * 0.2;

  const numerator = success + disputeWinsCredit;
  const denominator = success + defaults + slaMisses + disputeLosses + disputeWinsCredit;

  if (denominator <= 0) {
    return 1;
  }

  const value = numerator / denominator;
  return Math.max(0, Math.min(1, value));
}
