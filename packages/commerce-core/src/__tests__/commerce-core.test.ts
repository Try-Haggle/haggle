import { describe, it, expect } from "vitest";
import { checkHoldExpiration } from "../hold-expiration.js";
import { determineNextAction, computeOrderPhase } from "../order-lifecycle.js";
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
});
