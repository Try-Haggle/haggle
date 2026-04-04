import { describe, it, expect } from "vitest";
import { checkHoldExpiration } from "../hold-expiration.js";
import { determineNextAction, computeOrderPhase } from "../order-lifecycle.js";
import { transitionApprovalState } from "../approval-state-machine.js";
import {
  resolveTrustPenaltyReason,
  trustPenaltyScore,
  computeSettlementReliability,
} from "../trust-policy.js";
import type { TrustTriggerEvent } from "../trust-policy.js";
import {
  computeCompetitivePressure,
  inferPressureDirection,
} from "../market-pressure.js";
import { validateMinimumTransaction } from "../approval-policy.js";
import type { HoldSnapshot } from "../approval-policy.js";
import type { OrderState } from "../order-lifecycle.js";

// ---------------------------------------------------------------------------
// Hold Expiration
// ---------------------------------------------------------------------------
describe("checkHoldExpiration", () => {
  it("returns not expired when hold is undefined", () => {
    const result = checkHoldExpiration(undefined, "2026-03-16T12:00:00Z");
    expect(result.expired).toBe(false);
    expect(result.expires_at).toBeUndefined();
    expect(result.remaining_ms).toBeUndefined();
  });

  it("returns not expired when hold has no expires_at", () => {
    const hold: HoldSnapshot = {
      kind: "SOFT_HOLD",
      held_snapshot_price_minor: 50000,
      held_at: "2026-03-16T10:00:00Z",
      resume_reprice_required: true,
    };
    const result = checkHoldExpiration(hold, "2026-03-16T12:00:00Z");
    expect(result.expired).toBe(false);
    expect(result.expires_at).toBeUndefined();
    expect(result.remaining_ms).toBeUndefined();
  });

  it("returns not expired when current time is before expires_at", () => {
    const hold: HoldSnapshot = {
      kind: "SELLER_RESERVED",
      held_snapshot_price_minor: 50000,
      held_at: "2026-03-16T10:00:00Z",
      resume_reprice_required: false,
      expires_at: "2026-03-16T14:00:00Z",
    };
    const result = checkHoldExpiration(hold, "2026-03-16T12:00:00Z");
    expect(result.expired).toBe(false);
    expect(result.expires_at).toBe("2026-03-16T14:00:00Z");
    expect(result.remaining_ms).toBe(2 * 60 * 60 * 1000); // 2 hours
  });

  it("returns expired when current time equals expires_at", () => {
    const hold: HoldSnapshot = {
      kind: "SELLER_RESERVED",
      held_snapshot_price_minor: 50000,
      held_at: "2026-03-16T10:00:00Z",
      resume_reprice_required: false,
      expires_at: "2026-03-16T12:00:00Z",
    };
    const result = checkHoldExpiration(hold, "2026-03-16T12:00:00Z");
    expect(result.expired).toBe(true);
    expect(result.remaining_ms).toBe(0);
  });

  it("returns expired when current time is after expires_at", () => {
    const hold: HoldSnapshot = {
      kind: "SELLER_RESERVED",
      held_snapshot_price_minor: 50000,
      held_at: "2026-03-16T10:00:00Z",
      resume_reprice_required: false,
      expires_at: "2026-03-16T11:00:00Z",
    };
    const result = checkHoldExpiration(hold, "2026-03-16T12:00:00Z");
    expect(result.expired).toBe(true);
    expect(result.expires_at).toBe("2026-03-16T11:00:00Z");
    expect(result.remaining_ms).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// determineNextAction
// ---------------------------------------------------------------------------
describe("determineNextAction", () => {
  it("NEGOTIATION phase returns no_action", () => {
    const state: OrderState = { phase: "NEGOTIATION" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("APPROVAL phase with APPROVED returns create_payment_intent", () => {
    const state: OrderState = { phase: "APPROVAL", approval_state: "APPROVED" };
    expect(determineNextAction(state)).toEqual({ type: "create_payment_intent" });
  });

  it("APPROVAL phase with DECLINED returns no_action", () => {
    const state: OrderState = { phase: "APPROVAL", approval_state: "DECLINED" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("APPROVAL phase with EXPIRED returns no_action", () => {
    const state: OrderState = { phase: "APPROVAL", approval_state: "EXPIRED" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("APPROVAL phase with pending state returns no_action", () => {
    const state: OrderState = { phase: "APPROVAL", approval_state: "AWAITING_SELLER_APPROVAL" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("PAYMENT phase with SETTLED returns await_shipment_input", () => {
    const state: OrderState = { phase: "PAYMENT", payment_status: "SETTLED" };
    expect(determineNextAction(state)).toEqual({ type: "await_shipment_input" });
  });

  it("PAYMENT phase with FAILED returns no_action", () => {
    const state: OrderState = { phase: "PAYMENT", payment_status: "FAILED" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("PAYMENT phase with EXPIRED returns no_action", () => {
    const state: OrderState = { phase: "PAYMENT", payment_status: "EXPIRED" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("PAYMENT phase with PENDING returns no_action", () => {
    const state: OrderState = { phase: "PAYMENT", payment_status: "PENDING" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("FULFILLMENT phase with IN_TRANSIT returns await_delivery", () => {
    const state: OrderState = { phase: "FULFILLMENT", shipment_status: "IN_TRANSIT" };
    expect(determineNextAction(state)).toEqual({ type: "await_delivery" });
  });

  it("FULFILLMENT phase with SLA_MISSED returns open_dispute", () => {
    const state: OrderState = { phase: "FULFILLMENT", shipment_status: "SLA_MISSED" };
    expect(determineNextAction(state)).toEqual({
      type: "open_dispute",
      reason_code: "SHIPMENT_SLA_MISSED",
    });
  });

  it("FULFILLMENT phase with no shipment status returns check_shipment_sla", () => {
    const state: OrderState = { phase: "FULFILLMENT" };
    expect(determineNextAction(state)).toEqual({ type: "check_shipment_sla" });
  });

  it("DELIVERY phase with DELIVERED returns complete_order", () => {
    const state: OrderState = { phase: "DELIVERY", shipment_status: "DELIVERED" };
    expect(determineNextAction(state)).toEqual({ type: "complete_order" });
  });

  it("DELIVERY phase with DELIVERY_EXCEPTION returns open_dispute", () => {
    const state: OrderState = { phase: "DELIVERY", shipment_status: "DELIVERY_EXCEPTION" };
    expect(determineNextAction(state)).toEqual({
      type: "open_dispute",
      reason_code: "DELIVERY_EXCEPTION",
    });
  });

  it("DELIVERY phase with IN_TRANSIT returns await_delivery", () => {
    const state: OrderState = { phase: "DELIVERY", shipment_status: "IN_TRANSIT" };
    expect(determineNextAction(state)).toEqual({ type: "await_delivery" });
  });

  it("COMPLETED phase returns no_action", () => {
    const state: OrderState = { phase: "COMPLETED" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("IN_DISPUTE with RESOLVED_REFUND returns process_refund", () => {
    const state: OrderState = { phase: "IN_DISPUTE", dispute_status: "RESOLVED_REFUND" };
    expect(determineNextAction(state)).toEqual({ type: "process_refund" });
  });

  it("IN_DISPUTE with RESOLVED_NO_REFUND returns complete_order", () => {
    const state: OrderState = { phase: "IN_DISPUTE", dispute_status: "RESOLVED_NO_REFUND" };
    expect(determineNextAction(state)).toEqual({ type: "complete_order" });
  });

  it("IN_DISPUTE with pending dispute returns no_action", () => {
    const state: OrderState = { phase: "IN_DISPUTE", dispute_status: "OPEN" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("CANCELED phase returns no_action", () => {
    const state: OrderState = { phase: "CANCELED" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("REFUNDED phase returns no_action", () => {
    const state: OrderState = { phase: "REFUNDED" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("DELIVERY phase with DELIVERED and pending product release returns start_buyer_review", () => {
    const state: OrderState = { phase: "DELIVERY", shipment_status: "DELIVERED", product_release_status: "PENDING_DELIVERY" };
    expect(determineNextAction(state)).toEqual({ type: "start_buyer_review" });
  });

  it("DELIVERY phase with DELIVERED and BUYER_REVIEW returns release_product_payment", () => {
    const state: OrderState = { phase: "DELIVERY", shipment_status: "DELIVERED", product_release_status: "BUYER_REVIEW" };
    expect(determineNextAction(state)).toEqual({ type: "release_product_payment" });
  });

  it("COMPLETED phase with buffer HELD returns release_weight_buffer", () => {
    const state: OrderState = { phase: "COMPLETED", buffer_release_status: "HELD" };
    expect(determineNextAction(state)).toEqual({ type: "release_weight_buffer" });
  });

  it("COMPLETED phase with buffer ADJUSTING returns release_weight_buffer", () => {
    const state: OrderState = { phase: "COMPLETED", buffer_release_status: "ADJUSTING" };
    expect(determineNextAction(state)).toEqual({ type: "release_weight_buffer" });
  });

  it("COMPLETED phase with buffer RELEASED returns no_action", () => {
    const state: OrderState = { phase: "COMPLETED", buffer_release_status: "RELEASED" };
    expect(determineNextAction(state)).toEqual({ type: "no_action" });
  });

  it("DELIVERY with DELIVERED but no release status (backward compat) returns complete_order", () => {
    const state: OrderState = { phase: "DELIVERY", shipment_status: "DELIVERED" };
    expect(determineNextAction(state)).toEqual({ type: "complete_order" });
  });
});

// ---------------------------------------------------------------------------
// computeOrderPhase
// ---------------------------------------------------------------------------
describe("computeOrderPhase", () => {
  it("defaults to NEGOTIATION when no statuses set", () => {
    expect(computeOrderPhase({})).toBe("NEGOTIATION");
  });

  it("returns NEGOTIATION when approval is NEGOTIATING", () => {
    expect(computeOrderPhase({ approval_state: "NEGOTIATING" })).toBe("NEGOTIATION");
  });

  it("returns APPROVAL when approval is in progress", () => {
    expect(computeOrderPhase({ approval_state: "AWAITING_SELLER_APPROVAL" })).toBe("APPROVAL");
  });

  it("returns APPROVAL for MUTUALLY_ACCEPTABLE", () => {
    expect(computeOrderPhase({ approval_state: "MUTUALLY_ACCEPTABLE" })).toBe("APPROVAL");
  });

  it("returns APPROVAL for AWAITING_BUYER_APPROVAL", () => {
    expect(computeOrderPhase({ approval_state: "AWAITING_BUYER_APPROVAL" })).toBe("APPROVAL");
  });

  it("returns APPROVAL for HELD_BY_BUYER", () => {
    expect(computeOrderPhase({ approval_state: "HELD_BY_BUYER" })).toBe("APPROVAL");
  });

  it("returns PAYMENT when approval is APPROVED but no payment", () => {
    expect(computeOrderPhase({ approval_state: "APPROVED" })).toBe("PAYMENT");
  });

  it("returns PAYMENT when payment is INTENT_CREATED", () => {
    expect(
      computeOrderPhase({ approval_state: "APPROVED", payment_status: "INTENT_CREATED" }),
    ).toBe("PAYMENT");
  });

  it("returns PAYMENT when payment is AUTHORIZED", () => {
    expect(
      computeOrderPhase({ approval_state: "APPROVED", payment_status: "AUTHORIZED" }),
    ).toBe("PAYMENT");
  });

  it("returns PAYMENT when payment is PENDING", () => {
    expect(
      computeOrderPhase({ approval_state: "APPROVED", payment_status: "PENDING" }),
    ).toBe("PAYMENT");
  });

  it("returns FULFILLMENT when payment is SETTLED and no shipment", () => {
    expect(
      computeOrderPhase({ approval_state: "APPROVED", payment_status: "SETTLED" }),
    ).toBe("FULFILLMENT");
  });

  it("returns FULFILLMENT when shipment is LABEL_CREATED", () => {
    expect(
      computeOrderPhase({ payment_status: "SETTLED", shipment_status: "LABEL_CREATED" }),
    ).toBe("FULFILLMENT");
  });

  it("returns FULFILLMENT when shipment is PENDING_PICKUP", () => {
    expect(
      computeOrderPhase({ payment_status: "SETTLED", shipment_status: "PENDING_PICKUP" }),
    ).toBe("FULFILLMENT");
  });

  it("returns FULFILLMENT when shipment SLA is missed", () => {
    expect(
      computeOrderPhase({ payment_status: "SETTLED", shipment_status: "SLA_MISSED" }),
    ).toBe("FULFILLMENT");
  });

  it("returns DELIVERY when shipment is IN_TRANSIT", () => {
    expect(
      computeOrderPhase({ payment_status: "SETTLED", shipment_status: "IN_TRANSIT" }),
    ).toBe("DELIVERY");
  });

  it("returns DELIVERY when shipment is OUT_FOR_DELIVERY", () => {
    expect(
      computeOrderPhase({ payment_status: "SETTLED", shipment_status: "OUT_FOR_DELIVERY" }),
    ).toBe("DELIVERY");
  });

  it("returns DELIVERY when shipment has DELIVERY_EXCEPTION", () => {
    expect(
      computeOrderPhase({ payment_status: "SETTLED", shipment_status: "DELIVERY_EXCEPTION" }),
    ).toBe("DELIVERY");
  });

  it("returns COMPLETED when shipment is DELIVERED", () => {
    expect(
      computeOrderPhase({ payment_status: "SETTLED", shipment_status: "DELIVERED" }),
    ).toBe("COMPLETED");
  });

  it("returns IN_DISPUTE when dispute is OPEN", () => {
    expect(
      computeOrderPhase({ payment_status: "SETTLED", dispute_status: "OPEN" }),
    ).toBe("IN_DISPUTE");
  });

  it("returns IN_DISPUTE when dispute is UNDER_REVIEW", () => {
    expect(
      computeOrderPhase({ dispute_status: "UNDER_REVIEW" }),
    ).toBe("IN_DISPUTE");
  });

  it("returns REFUNDED when dispute resolved with refund", () => {
    expect(
      computeOrderPhase({ dispute_status: "RESOLVED_REFUND" }),
    ).toBe("REFUNDED");
  });

  it("returns COMPLETED when dispute resolved without refund", () => {
    expect(
      computeOrderPhase({ dispute_status: "RESOLVED_NO_REFUND" }),
    ).toBe("COMPLETED");
  });

  it("returns REFUNDED when payment is REFUNDED", () => {
    expect(
      computeOrderPhase({ payment_status: "REFUNDED" }),
    ).toBe("REFUNDED");
  });

  it("returns CANCELED when approval DECLINED and no payment", () => {
    expect(
      computeOrderPhase({ approval_state: "DECLINED" }),
    ).toBe("CANCELED");
  });

  it("returns CANCELED when approval EXPIRED and no payment", () => {
    expect(
      computeOrderPhase({ approval_state: "EXPIRED" }),
    ).toBe("CANCELED");
  });

  it("returns CANCELED when payment is CANCELED", () => {
    expect(
      computeOrderPhase({ payment_status: "CANCELED" }),
    ).toBe("CANCELED");
  });

  it("dispute overrides shipment status", () => {
    expect(
      computeOrderPhase({
        payment_status: "SETTLED",
        shipment_status: "IN_TRANSIT",
        dispute_status: "OPEN",
      }),
    ).toBe("IN_DISPUTE");
  });

  it("REFUNDED payment takes priority over dispute", () => {
    expect(
      computeOrderPhase({
        payment_status: "REFUNDED",
        dispute_status: "OPEN",
      }),
    ).toBe("REFUNDED");
  });

  it("stays in DELIVERY when delivered but product not released", () => {
    expect(computeOrderPhase({
      payment_status: "SETTLED",
      shipment_status: "DELIVERED",
      product_release_status: "PENDING_DELIVERY",
    })).toBe("DELIVERY");
  });

  it("stays in DELIVERY during buyer review", () => {
    expect(computeOrderPhase({
      payment_status: "SETTLED",
      shipment_status: "DELIVERED",
      product_release_status: "BUYER_REVIEW",
    })).toBe("DELIVERY");
  });

  it("COMPLETED when product released (even if buffer still held)", () => {
    expect(computeOrderPhase({
      payment_status: "SETTLED",
      shipment_status: "DELIVERED",
      product_release_status: "RELEASED",
      buffer_release_status: "HELD",
    })).toBe("COMPLETED");
  });

  it("backward compat: COMPLETED when delivered without release status", () => {
    expect(computeOrderPhase({
      payment_status: "SETTLED",
      shipment_status: "DELIVERED",
    })).toBe("COMPLETED");
  });
});

// ---------------------------------------------------------------------------
// Approval State Machine
// ---------------------------------------------------------------------------
describe("transitionApprovalState", () => {
  describe("AUTO_WITHIN_POLICY mode", () => {
    const mode = "AUTO_WITHIN_POLICY" as const;

    it("NEGOTIATING → reach_candidate → MUTUALLY_ACCEPTABLE", () => {
      expect(transitionApprovalState(mode, "NEGOTIATING", "reach_candidate")).toBe("MUTUALLY_ACCEPTABLE");
    });

    it("NEGOTIATING → decline → DECLINED", () => {
      expect(transitionApprovalState(mode, "NEGOTIATING", "decline")).toBe("DECLINED");
    });

    it("NEGOTIATING → expire → EXPIRED", () => {
      expect(transitionApprovalState(mode, "NEGOTIATING", "expire")).toBe("EXPIRED");
    });

    it("MUTUALLY_ACCEPTABLE → buyer_approve → APPROVED (auto)", () => {
      expect(transitionApprovalState(mode, "MUTUALLY_ACCEPTABLE", "buyer_approve")).toBe("APPROVED");
    });

    it("MUTUALLY_ACCEPTABLE → buyer_hold → HELD_BY_BUYER", () => {
      expect(transitionApprovalState(mode, "MUTUALLY_ACCEPTABLE", "buyer_hold")).toBe("HELD_BY_BUYER");
    });

    it("MUTUALLY_ACCEPTABLE → seller_reserve → RESERVED_PENDING_APPROVAL", () => {
      expect(transitionApprovalState(mode, "MUTUALLY_ACCEPTABLE", "seller_reserve")).toBe("RESERVED_PENDING_APPROVAL");
    });

    it("HELD_BY_BUYER → resume_negotiation → NEGOTIATING", () => {
      expect(transitionApprovalState(mode, "HELD_BY_BUYER", "resume_negotiation")).toBe("NEGOTIATING");
    });

    it("HELD_BY_BUYER → buyer_approve → APPROVED (auto)", () => {
      expect(transitionApprovalState(mode, "HELD_BY_BUYER", "buyer_approve")).toBe("APPROVED");
    });

    it("RESERVED_PENDING_APPROVAL → buyer_approve → APPROVED (auto)", () => {
      expect(transitionApprovalState(mode, "RESERVED_PENDING_APPROVAL", "buyer_approve")).toBe("APPROVED");
    });

    it("RESERVED_PENDING_APPROVAL → resume_negotiation → NEGOTIATING", () => {
      expect(transitionApprovalState(mode, "RESERVED_PENDING_APPROVAL", "resume_negotiation")).toBe("NEGOTIATING");
    });

    it("terminal states return null", () => {
      expect(transitionApprovalState(mode, "APPROVED", "decline")).toBeNull();
      expect(transitionApprovalState(mode, "DECLINED", "buyer_approve")).toBeNull();
      expect(transitionApprovalState(mode, "EXPIRED", "resume_negotiation")).toBeNull();
    });

    it("AWAITING_SELLER_APPROVAL is unreachable in AUTO mode", () => {
      expect(transitionApprovalState(mode, "AWAITING_SELLER_APPROVAL", "seller_approve")).toBeNull();
    });

    it("invalid events return null", () => {
      expect(transitionApprovalState(mode, "NEGOTIATING", "seller_approve")).toBeNull();
      expect(transitionApprovalState(mode, "MUTUALLY_ACCEPTABLE", "resume_negotiation")).toBeNull();
    });
  });

  describe("MANUAL_CONFIRMATION mode", () => {
    const mode = "MANUAL_CONFIRMATION" as const;

    it("MUTUALLY_ACCEPTABLE → buyer_approve → AWAITING_SELLER_APPROVAL (not direct APPROVED)", () => {
      expect(transitionApprovalState(mode, "MUTUALLY_ACCEPTABLE", "buyer_approve")).toBe("AWAITING_SELLER_APPROVAL");
    });

    it("AWAITING_SELLER_APPROVAL → seller_approve → APPROVED", () => {
      expect(transitionApprovalState(mode, "AWAITING_SELLER_APPROVAL", "seller_approve")).toBe("APPROVED");
    });

    it("AWAITING_SELLER_APPROVAL → decline → DECLINED", () => {
      expect(transitionApprovalState(mode, "AWAITING_SELLER_APPROVAL", "decline")).toBe("DECLINED");
    });

    it("AWAITING_SELLER_APPROVAL → expire → EXPIRED", () => {
      expect(transitionApprovalState(mode, "AWAITING_SELLER_APPROVAL", "expire")).toBe("EXPIRED");
    });

    it("HELD_BY_BUYER → buyer_approve → AWAITING_SELLER_APPROVAL (manual)", () => {
      expect(transitionApprovalState(mode, "HELD_BY_BUYER", "buyer_approve")).toBe("AWAITING_SELLER_APPROVAL");
    });

    it("RESERVED_PENDING_APPROVAL → buyer_approve → AWAITING_SELLER_APPROVAL (manual)", () => {
      expect(transitionApprovalState(mode, "RESERVED_PENDING_APPROVAL", "buyer_approve")).toBe("AWAITING_SELLER_APPROVAL");
    });

    it("terminal states return null", () => {
      expect(transitionApprovalState(mode, "APPROVED", "decline")).toBeNull();
      expect(transitionApprovalState(mode, "DECLINED", "buyer_approve")).toBeNull();
      expect(transitionApprovalState(mode, "EXPIRED", "resume_negotiation")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Trust Policy
// ---------------------------------------------------------------------------
describe("resolveTrustPenaltyReason", () => {
  it("maps buyer_approved_but_not_paid", () => {
    const event: TrustTriggerEvent = { module: "payment", actor_role: "buyer", type: "buyer_approved_but_not_paid" };
    expect(resolveTrustPenaltyReason(event)).toBe("BUYER_APPROVED_BUT_NOT_PAID");
  });

  it("maps seller_approved_but_not_fulfilled", () => {
    const event: TrustTriggerEvent = { module: "shipping", actor_role: "seller", type: "seller_approved_but_not_fulfilled" };
    expect(resolveTrustPenaltyReason(event)).toBe("SELLER_APPROVED_BUT_NOT_FULFILLED");
  });

  it("maps shipment_input_sla_missed", () => {
    const event: TrustTriggerEvent = { module: "shipping", actor_role: "seller", type: "shipment_input_sla_missed" };
    expect(resolveTrustPenaltyReason(event)).toBe("SHIPMENT_INFO_SLA_MISSED");
  });

  it("maps dispute_loss", () => {
    const event: TrustTriggerEvent = { module: "dispute", actor_role: "seller", type: "dispute_loss" };
    expect(resolveTrustPenaltyReason(event)).toBe("DISPUTE_LOSS");
  });

  it("returns null for non-penalty events", () => {
    const win: TrustTriggerEvent = { module: "dispute", actor_role: "buyer", type: "dispute_win" };
    expect(resolveTrustPenaltyReason(win)).toBeNull();
    const success: TrustTriggerEvent = { module: "payment", actor_role: "buyer", type: "successful_settlement" };
    expect(resolveTrustPenaltyReason(success)).toBeNull();
  });
});

describe("trustPenaltyScore", () => {
  it("BUYER_APPROVED_BUT_NOT_PAID = 0.35", () => {
    expect(trustPenaltyScore("BUYER_APPROVED_BUT_NOT_PAID")).toBe(0.35);
  });

  it("SELLER_APPROVED_BUT_NOT_FULFILLED = 0.4", () => {
    expect(trustPenaltyScore("SELLER_APPROVED_BUT_NOT_FULFILLED")).toBe(0.4);
  });

  it("SHIPMENT_INFO_SLA_MISSED = 0.2", () => {
    expect(trustPenaltyScore("SHIPMENT_INFO_SLA_MISSED")).toBe(0.2);
  });

  it("DISPUTE_LOSS = 0.3", () => {
    expect(trustPenaltyScore("DISPUTE_LOSS")).toBe(0.3);
  });
});

describe("computeSettlementReliability", () => {
  const base = { actor_id: "user-1", actor_role: "seller" as const };

  it("returns 1.0 for perfect record", () => {
    expect(computeSettlementReliability({
      ...base,
      successful_settlements: 10,
      approval_defaults: 0,
      shipment_sla_misses: 0,
      dispute_wins: 0,
      dispute_losses: 0,
    })).toBe(1);
  });

  it("returns 1.0 for empty record", () => {
    expect(computeSettlementReliability({
      ...base,
      successful_settlements: 0,
      approval_defaults: 0,
      shipment_sla_misses: 0,
      dispute_wins: 0,
      dispute_losses: 0,
    })).toBe(1);
  });

  it("defaults reduce reliability", () => {
    const result = computeSettlementReliability({
      ...base,
      successful_settlements: 8,
      approval_defaults: 2,
      shipment_sla_misses: 0,
      dispute_wins: 0,
      dispute_losses: 0,
    });
    // numerator = 8, denominator = 8 + 3 = 11
    expect(result).toBeCloseTo(8 / 11, 5);
  });

  it("dispute wins give small credit", () => {
    const result = computeSettlementReliability({
      ...base,
      successful_settlements: 5,
      approval_defaults: 0,
      shipment_sla_misses: 0,
      dispute_wins: 5,
      dispute_losses: 0,
    });
    // numerator = 5 + 1 = 6, denominator = 5 + 1 = 6
    expect(result).toBe(1);
  });

  it("mixed record gives fractional reliability", () => {
    const result = computeSettlementReliability({
      ...base,
      successful_settlements: 10,
      approval_defaults: 2,
      shipment_sla_misses: 1,
      dispute_wins: 1,
      dispute_losses: 1,
    });
    // numerator = 10 + 0.2 = 10.2
    // denominator = 10 + 3 + 1 + 1.2 + 0.2 = 15.4
    expect(result).toBeCloseTo(10.2 / 15.4, 5);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it("clamps to [0, 1]", () => {
    const result = computeSettlementReliability({
      ...base,
      successful_settlements: 0,
      approval_defaults: 10,
      shipment_sla_misses: 10,
      dispute_wins: 0,
      dispute_losses: 10,
    });
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Market Pressure
// ---------------------------------------------------------------------------
describe("computeCompetitivePressure", () => {
  const defaultPolicy = {
    demand_pressure_weight: 1.0,
    supply_pressure_weight: 1.0,
    cheaper_listing_weight: 1.0,
    manual_seller_friction_weight: 0.0,
  };

  it("returns 0 when no activity", () => {
    expect(computeCompetitivePressure(0, 0, 0, defaultPolicy)).toBe(0);
  });

  it("high demand with no supply → positive pressure", () => {
    const result = computeCompetitivePressure(10, 0, 0, defaultPolicy);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
    // only 1 of 3 dimensions active → moderate value
    expect(result).toBeCloseTo(0.222, 2);
  });

  it("high supply with no demand → positive pressure", () => {
    const result = computeCompetitivePressure(0, 10, 5, defaultPolicy);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
    // 2 of 3 dimensions active → higher value
    expect(result).toBeGreaterThan(0.2);
  });

  it("balanced demand and supply → moderate pressure", () => {
    const result = computeCompetitivePressure(5, 5, 2, defaultPolicy);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("respects weight configuration", () => {
    const zeroDemand = { ...defaultPolicy, demand_pressure_weight: 0 };
    const fullDemand = computeCompetitivePressure(10, 0, 0, defaultPolicy);
    const noDemand = computeCompetitivePressure(10, 0, 0, zeroDemand);
    expect(noDemand).toBeLessThan(fullDemand);
  });

  it("always returns value in [0, 1]", () => {
    const result = computeCompetitivePressure(100, 100, 100, defaultPolicy);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe("inferPressureDirection", () => {
  it("UPWARD when demand > supply", () => {
    expect(inferPressureDirection(0.8, 0.2)).toBe("UPWARD");
  });

  it("DOWNWARD when supply > demand", () => {
    expect(inferPressureDirection(0.2, 0.8)).toBe("DOWNWARD");
  });

  it("NEUTRAL when roughly equal", () => {
    expect(inferPressureDirection(0.5, 0.5)).toBe("NEUTRAL");
  });

  it("NEUTRAL when both zero", () => {
    expect(inferPressureDirection(0, 0)).toBe("NEUTRAL");
  });
});

// ---------------------------------------------------------------------------
// validateMinimumTransaction
// ---------------------------------------------------------------------------
describe("validateMinimumTransaction", () => {
  it("allows shipped transaction at $10", () => {
    expect(validateMinimumTransaction(10_00, "shipped").valid).toBe(true);
  });

  it("allows shipped transaction above $10", () => {
    expect(validateMinimumTransaction(50_00, "shipped").valid).toBe(true);
  });

  it("rejects shipped transaction below $10", () => {
    const result = validateMinimumTransaction(9_99, "shipped");
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects shipped transaction at $0", () => {
    const result = validateMinimumTransaction(0, "shipped");
    expect(result.valid).toBe(false);
  });

  it("allows local pickup below $10", () => {
    expect(validateMinimumTransaction(5_00, "local_pickup").valid).toBe(true);
  });

  it("allows local pickup at $0", () => {
    expect(validateMinimumTransaction(0, "local_pickup").valid).toBe(true);
  });

  it("allows local pickup at $1", () => {
    expect(validateMinimumTransaction(1_00, "local_pickup").valid).toBe(true);
  });
});
