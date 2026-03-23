import { describe, it, expect } from "vitest";
import { transitionPaymentIntent } from "../state-machine.js";
import { trustTriggersForPaymentTransition } from "../trust-events.js";
import {
  assertPaymentReadyForExecution,
  assertActorInSettlementApproval,
} from "../execution.js";
import { createId } from "../id.js";
import { PaymentService } from "../service.js";
import { MockX402Adapter } from "../mock-x402-adapter.js";
import { MockStripeAdapter } from "../mock-stripe-adapter.js";
import type { PaymentIntent, PaymentIntentStatus } from "../types.js";
import type { SettlementApproval } from "@haggle/commerce-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: "pi_test_001",
    order_id: "ord_001",
    seller_id: "seller_001",
    buyer_id: "buyer_001",
    selected_rail: "x402",
    allowed_rails: ["x402"],
    amount: { currency: "USDC", amount_minor: 100_00 },
    status: "CREATED",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeApproval(overrides: Partial<SettlementApproval> = {}): SettlementApproval {
  return {
    id: "sa_001",
    approval_state: "APPROVED",
    seller_policy: {
      mode: "AUTO_WITHIN_POLICY",
      fulfillment_sla: { shipment_input_due_days: 3 },
      responsiveness: {
        median_response_minutes: 30,
        p95_response_minutes: 120,
        reliable_fast_responder: true,
      },
    },
    terms: {
      listing_id: "lst_001",
      seller_id: "seller_001",
      buyer_id: "buyer_001",
      final_amount_minor: 100_00,
      currency: "USDC",
      selected_payment_rail: "x402",
    },
    buyer_approved_at: "2026-01-01T00:00:00.000Z",
    seller_approved_at: "2026-01-01T00:01:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}

// ===========================================================================
// 1. State Machine: transitionPaymentIntent
// ===========================================================================

describe("transitionPaymentIntent", () => {
  describe("valid transitions", () => {
    const validCases: Array<[PaymentIntentStatus, string, PaymentIntentStatus]> = [
      // Happy path
      ["CREATED", "quote", "QUOTED"],
      ["CREATED", "authorize", "AUTHORIZED"],
      ["QUOTED", "authorize", "AUTHORIZED"],
      ["AUTHORIZED", "mark_settlement_pending", "SETTLEMENT_PENDING"],
      ["SETTLEMENT_PENDING", "settle", "SETTLED"],

      // Cancel paths
      ["CREATED", "cancel", "CANCELED"],
      ["QUOTED", "cancel", "CANCELED"],
      ["AUTHORIZED", "cancel", "CANCELED"],

      // Fail paths
      ["CREATED", "fail", "FAILED"],
      ["QUOTED", "fail", "FAILED"],
      ["AUTHORIZED", "fail", "FAILED"],
      ["SETTLEMENT_PENDING", "fail", "FAILED"],
    ];

    it.each(validCases)(
      "%s + %s -> %s",
      (from, event, expected) => {
        expect(transitionPaymentIntent(from, event as any)).toBe(expected);
      },
    );
  });

  describe("invalid transitions return null", () => {
    const invalidCases: Array<[PaymentIntentStatus, string]> = [
      // Terminal states accept nothing
      ["SETTLED", "quote"],
      ["SETTLED", "authorize"],
      ["SETTLED", "settle"],
      ["SETTLED", "cancel"],
      ["SETTLED", "fail"],
      ["FAILED", "quote"],
      ["FAILED", "authorize"],
      ["FAILED", "cancel"],
      ["CANCELED", "quote"],
      ["CANCELED", "authorize"],
      ["CANCELED", "settle"],

      // Out-of-order transitions
      ["CREATED", "settle"],
      ["CREATED", "mark_settlement_pending"],
      ["QUOTED", "settle"],
      ["QUOTED", "mark_settlement_pending"],
      ["SETTLEMENT_PENDING", "cancel"],
      ["SETTLEMENT_PENDING", "authorize"],
    ];

    it.each(invalidCases)(
      "%s + %s -> null",
      (from, event) => {
        expect(transitionPaymentIntent(from, event as any)).toBeNull();
      },
    );
  });

  it("full happy path CREATED -> QUOTED -> AUTHORIZED -> SETTLEMENT_PENDING -> SETTLED", () => {
    let status: PaymentIntentStatus = "CREATED";
    status = transitionPaymentIntent(status, "quote")!;
    expect(status).toBe("QUOTED");
    status = transitionPaymentIntent(status, "authorize")!;
    expect(status).toBe("AUTHORIZED");
    status = transitionPaymentIntent(status, "mark_settlement_pending")!;
    expect(status).toBe("SETTLEMENT_PENDING");
    status = transitionPaymentIntent(status, "settle")!;
    expect(status).toBe("SETTLED");
  });

  it("skip QUOTED path: CREATED -> AUTHORIZED directly", () => {
    const status = transitionPaymentIntent("CREATED", "authorize");
    expect(status).toBe("AUTHORIZED");
  });
});

// ===========================================================================
// 2. Trust Events: trustTriggersForPaymentTransition
// ===========================================================================

describe("trustTriggersForPaymentTransition", () => {
  it("returns buyer_approved_but_not_paid when transitioning to FAILED from non-SETTLED", () => {
    const triggers = trustTriggersForPaymentTransition("AUTHORIZED", "FAILED");
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toEqual({
      module: "payment",
      actor_role: "buyer",
      type: "buyer_approved_but_not_paid",
    });
  });

  it("returns empty triggers when canceling from CREATED (no commitment yet)", () => {
    const triggers = trustTriggersForPaymentTransition("CREATED", "CANCELED");
    expect(triggers).toHaveLength(0);
  });

  it("returns buyer_approved_but_not_paid when canceling from AUTHORIZED", () => {
    const triggers = trustTriggersForPaymentTransition("AUTHORIZED", "CANCELED");
    expect(triggers).toHaveLength(1);
    expect(triggers[0].type).toBe("buyer_approved_but_not_paid");
  });

  it("returns successful_settlement triggers for both buyer and seller on SETTLED", () => {
    const triggers = trustTriggersForPaymentTransition("SETTLEMENT_PENDING", "SETTLED");
    expect(triggers).toHaveLength(2);

    const buyerTrigger = triggers.find((t) => t.actor_role === "buyer");
    const sellerTrigger = triggers.find((t) => t.actor_role === "seller");

    expect(buyerTrigger).toEqual({
      module: "payment",
      actor_role: "buyer",
      type: "successful_settlement",
    });
    expect(sellerTrigger).toEqual({
      module: "payment",
      actor_role: "seller",
      type: "successful_settlement",
    });
  });

  it("returns empty array for non-terminal transitions", () => {
    expect(trustTriggersForPaymentTransition("CREATED", "QUOTED")).toEqual([]);
    expect(trustTriggersForPaymentTransition("QUOTED", "AUTHORIZED")).toEqual([]);
    expect(trustTriggersForPaymentTransition("AUTHORIZED", "SETTLEMENT_PENDING")).toEqual([]);
  });

  it("returns empty array when previous is SETTLED (edge case -- shouldn't happen)", () => {
    // The condition checks previous !== "SETTLED", so SETTLED -> FAILED returns triggers,
    // but SETTLED -> FAILED transition doesn't exist in the state machine.
    // However, the function itself doesn't enforce state machine rules.
    // From SETTLED, next=FAILED: previous === "SETTLED" so the first condition is skipped.
    // next !== "SETTLED" so the second condition is skipped. Returns [].
    // Wait, previous IS "SETTLED" so (next === "FAILED" && previous !== "SETTLED") is false.
    expect(trustTriggersForPaymentTransition("SETTLED", "FAILED")).toEqual([]);
  });
});

// ===========================================================================
// 3. ID Generation: createId
// ===========================================================================

describe("createId", () => {
  it("generates a non-empty string without prefix", () => {
    const id = createId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createId()));
    expect(ids.size).toBe(100);
  });

  it("prepends prefix with underscore separator", () => {
    const id = createId("pay");
    expect(id.startsWith("pay_")).toBe(true);
  });

  it("different prefixes produce different formats", () => {
    const a = createId("x402");
    const b = createId("stripe");
    expect(a.startsWith("x402_")).toBe(true);
    expect(b.startsWith("stripe_")).toBe(true);
  });

  it("works without prefix (undefined)", () => {
    const id = createId(undefined);
    expect(id).not.toContain("undefined");
    expect(id.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 4. Execution Validation: assertPaymentReadyForExecution
// ===========================================================================

describe("assertPaymentReadyForExecution", () => {
  const buyerActor = { actor_id: "buyer_001", actor_role: "buyer" as const };
  const sellerActor = { actor_id: "seller_001", actor_role: "seller" as const };

  it("returns PaymentExecutionSnapshot for a valid APPROVED settlement (buyer actor)", () => {
    const snapshot = assertPaymentReadyForExecution(makeApproval(), buyerActor);
    expect(snapshot).toEqual({
      settlement_approval_id: "sa_001",
      listing_id: "lst_001",
      seller_id: "seller_001",
      buyer_id: "buyer_001",
      amount_minor: 100_00,
      currency: "USDC",
      selected_rail: "x402",
      actor: buyerActor,
    });
  });

  it("returns snapshot for seller actor", () => {
    const snapshot = assertPaymentReadyForExecution(makeApproval(), sellerActor);
    expect(snapshot.actor).toEqual(sellerActor);
  });

  it("throws when actor is not a participant", () => {
    const stranger = { actor_id: "stranger_001", actor_role: "buyer" as const };
    expect(() => assertPaymentReadyForExecution(makeApproval(), stranger)).toThrow(
      "actor is not a participant",
    );
  });

  it("throws when approval_state is not APPROVED", () => {
    const approval = makeApproval({ approval_state: "NEGOTIATING" });
    expect(() => assertPaymentReadyForExecution(approval, buyerActor)).toThrow(
      "payment execution requires APPROVED settlement",
    );
  });

  it("throws when buyer_approved_at is missing", () => {
    const approval = makeApproval({ buyer_approved_at: undefined });
    expect(() => assertPaymentReadyForExecution(approval, buyerActor)).toThrow(
      "buyer approval is required",
    );
  });

  it("throws when MANUAL_CONFIRMATION mode and seller_approved_at is missing", () => {
    const approval = makeApproval({
      seller_policy: {
        mode: "MANUAL_CONFIRMATION",
        fulfillment_sla: { shipment_input_due_days: 3 },
        responsiveness: {
          median_response_minutes: 30,
          p95_response_minutes: 120,
          reliable_fast_responder: true,
        },
      },
      seller_approved_at: undefined,
    });
    expect(() => assertPaymentReadyForExecution(approval, buyerActor)).toThrow(
      "seller approval is required",
    );
  });

  it("does not throw for AUTO_WITHIN_POLICY when seller_approved_at is missing", () => {
    const approval = makeApproval({ seller_approved_at: undefined });
    // AUTO_WITHIN_POLICY does not require seller_approved_at
    expect(() => assertPaymentReadyForExecution(approval, buyerActor)).not.toThrow();
  });

  it("throws when selected_payment_rail is missing", () => {
    const approval = makeApproval();
    (approval.terms as any).selected_payment_rail = undefined;
    expect(() => assertPaymentReadyForExecution(approval, buyerActor)).toThrow(
      "selected payment rail is missing",
    );
  });

  it("throws when currency is missing", () => {
    const approval = makeApproval();
    (approval.terms as any).currency = undefined;
    expect(() => assertPaymentReadyForExecution(approval, buyerActor)).toThrow(
      "currency is missing",
    );
  });

  it("throws when final_amount_minor is zero", () => {
    const approval = makeApproval();
    approval.terms.final_amount_minor = 0;
    expect(() => assertPaymentReadyForExecution(approval, buyerActor)).toThrow(
      "final amount must be positive",
    );
  });

  it("throws when final_amount_minor is negative", () => {
    const approval = makeApproval();
    approval.terms.final_amount_minor = -500;
    expect(() => assertPaymentReadyForExecution(approval, buyerActor)).toThrow(
      "final amount must be positive",
    );
  });
});

describe("assertActorInSettlementApproval", () => {
  it("does not throw for valid buyer", () => {
    expect(() =>
      assertActorInSettlementApproval(makeApproval(), {
        actor_id: "buyer_001",
        actor_role: "buyer",
      }),
    ).not.toThrow();
  });

  it("does not throw for valid seller", () => {
    expect(() =>
      assertActorInSettlementApproval(makeApproval(), {
        actor_id: "seller_001",
        actor_role: "seller",
      }),
    ).not.toThrow();
  });

  it("throws for mismatched buyer id", () => {
    expect(() =>
      assertActorInSettlementApproval(makeApproval(), {
        actor_id: "wrong_buyer",
        actor_role: "buyer",
      }),
    ).toThrow("actor is not a participant");
  });

  it("throws for mismatched seller id", () => {
    expect(() =>
      assertActorInSettlementApproval(makeApproval(), {
        actor_id: "wrong_seller",
        actor_role: "seller",
      }),
    ).toThrow("actor is not a participant");
  });
});

// ===========================================================================
// 5. PaymentService
// ===========================================================================

describe("PaymentService", () => {
  const NOW = "2026-01-15T12:00:00.000Z";

  describe("createIntent", () => {
    it("creates a payment intent with CREATED status", () => {
      const svc = new PaymentService({ x402: new MockX402Adapter() });
      const intent = svc.createIntent({
        order_id: "ord_100",
        seller_id: "s1",
        buyer_id: "b1",
        selected_rail: "x402",
        amount: { currency: "USDC", amount_minor: 50_00 },
        now: NOW,
      });

      expect(intent.status).toBe("CREATED");
      expect(intent.order_id).toBe("ord_100");
      expect(intent.seller_id).toBe("s1");
      expect(intent.buyer_id).toBe("b1");
      expect(intent.selected_rail).toBe("x402");
      expect(intent.amount).toEqual({ currency: "USDC", amount_minor: 50_00 });
      expect(intent.allowed_rails).toEqual(["x402"]);
      expect(intent.created_at).toBe(NOW);
      expect(intent.updated_at).toBe(NOW);
      expect(intent.id).toBeTruthy();
    });

    it("uses allowed_rails when provided", () => {
      const svc = new PaymentService({});
      const intent = svc.createIntent({
        order_id: "ord_101",
        seller_id: "s1",
        buyer_id: "b1",
        selected_rail: "x402",
        allowed_rails: ["x402", "stripe"],
        amount: { currency: "USDC", amount_minor: 25_00 },
      });

      expect(intent.allowed_rails).toEqual(["x402", "stripe"]);
    });

    it("sets buyer_authorization_mode when provided", () => {
      const svc = new PaymentService({});
      const intent = svc.createIntent({
        order_id: "ord_102",
        seller_id: "s1",
        buyer_id: "b1",
        selected_rail: "stripe",
        buyer_authorization_mode: "human_wallet",
        amount: { currency: "USD", amount_minor: 99_99 },
      });

      expect(intent.buyer_authorization_mode).toBe("human_wallet");
    });
  });

  describe("full lifecycle with MockX402Adapter", () => {
    it("CREATED -> quote -> authorize -> markSettlementPending -> settle", async () => {
      const svc = new PaymentService({ x402: new MockX402Adapter() });

      // Create
      let intent = svc.createIntent({
        order_id: "ord_200",
        seller_id: "s1",
        buyer_id: "b1",
        selected_rail: "x402",
        amount: { currency: "USDC", amount_minor: 200_00 },
        now: NOW,
      });
      expect(intent.status).toBe("CREATED");

      // Quote
      const quoteResult = await svc.quoteIntent(intent, NOW);
      intent = quoteResult.intent;
      expect(intent.status).toBe("QUOTED");
      expect(quoteResult.value).toBeDefined();
      expect(quoteResult.value!.rail).toBe("x402");
      expect(quoteResult.value!.provider_reference).toContain("x402_quote");
      expect(quoteResult.trust_triggers).toEqual([]);

      // Authorize
      const authResult = await svc.authorizeIntent(intent, NOW);
      intent = authResult.intent;
      expect(intent.status).toBe("AUTHORIZED");
      expect(authResult.value).toBeDefined();
      expect(authResult.value!.rail).toBe("x402");
      expect(authResult.trust_triggers).toEqual([]);

      // Mark settlement pending
      const pendingResult = svc.markSettlementPending(intent, NOW);
      intent = pendingResult.intent;
      expect(intent.status).toBe("SETTLEMENT_PENDING");
      expect(pendingResult.trust_triggers).toEqual([]);

      // Settle
      const settleResult = await svc.settleIntent(intent, NOW);
      intent = settleResult.intent;
      expect(intent.status).toBe("SETTLED");
      expect(settleResult.value).toBeDefined();
      expect(settleResult.value!.status).toBe("SETTLED");
      expect(settleResult.trust_triggers).toHaveLength(2);
      expect(settleResult.trust_triggers[0].type).toBe("successful_settlement");
      expect(settleResult.trust_triggers[1].type).toBe("successful_settlement");
    });
  });

  describe("full lifecycle with MockStripeAdapter", () => {
    it("completes a stripe payment lifecycle", async () => {
      const svc = new PaymentService({ stripe: new MockStripeAdapter() });

      let intent = svc.createIntent({
        order_id: "ord_300",
        seller_id: "s1",
        buyer_id: "b1",
        selected_rail: "stripe",
        amount: { currency: "USD", amount_minor: 150_00 },
        now: NOW,
      });

      const quoteResult = await svc.quoteIntent(intent, NOW);
      intent = quoteResult.intent;
      expect(intent.status).toBe("QUOTED");
      expect(quoteResult.value!.metadata).toHaveProperty("payment_method_types");

      const authResult = await svc.authorizeIntent(intent, NOW);
      intent = authResult.intent;
      expect(intent.status).toBe("AUTHORIZED");
      expect(authResult.metadata).toHaveProperty("payment_intent_secret");

      const pendingResult = svc.markSettlementPending(intent, NOW);
      intent = pendingResult.intent;

      const settleResult = await svc.settleIntent(intent, NOW);
      intent = settleResult.intent;
      expect(intent.status).toBe("SETTLED");
      expect(settleResult.metadata).toHaveProperty("charge_id");
    });
  });

  describe("cancel path", () => {
    it("cancels a CREATED intent with no trust penalty", () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "CREATED" });
      const result = svc.cancelIntent(intent, NOW);

      expect(result.intent.status).toBe("CANCELED");
      expect(result.trust_triggers).toHaveLength(0);
    });

    it("cancels a QUOTED intent", () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "QUOTED" });
      const result = svc.cancelIntent(intent, NOW);

      expect(result.intent.status).toBe("CANCELED");
    });

    it("cancels an AUTHORIZED intent", () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "AUTHORIZED" });
      const result = svc.cancelIntent(intent, NOW);

      expect(result.intent.status).toBe("CANCELED");
    });

    it("throws when cancelling a SETTLED intent", () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "SETTLED" });
      expect(() => svc.cancelIntent(intent, NOW)).toThrow("invalid payment transition");
    });

    it("throws when cancelling a SETTLEMENT_PENDING intent", () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "SETTLEMENT_PENDING" });
      expect(() => svc.cancelIntent(intent, NOW)).toThrow("invalid payment transition");
    });
  });

  describe("fail path", () => {
    it("fails a CREATED intent with no trust penalty", () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "CREATED" });
      const result = svc.failIntent(intent, NOW);

      expect(result.intent.status).toBe("FAILED");
      expect(result.trust_triggers).toHaveLength(0);
    });

    it("fails a SETTLEMENT_PENDING intent", () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "SETTLEMENT_PENDING" });
      const result = svc.failIntent(intent, NOW);

      expect(result.intent.status).toBe("FAILED");
    });

    it("throws when failing an already SETTLED intent", () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "SETTLED" });
      expect(() => svc.failIntent(intent, NOW)).toThrow("invalid payment transition");
    });

    it("throws when failing an already FAILED intent", () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "FAILED" });
      expect(() => svc.failIntent(intent, NOW)).toThrow("invalid payment transition");
    });
  });

  describe("refund guards", () => {
    it("throws when intent status is not SETTLED", async () => {
      const svc = new PaymentService({ x402: new MockX402Adapter() });
      const intent = makeIntent({ status: "AUTHORIZED" });
      const refund = {
        id: "ref_guard_001",
        payment_intent_id: intent.id,
        amount: { currency: "USDC", amount_minor: 50_00 },
        reason_code: "customer_request",
        status: "REQUESTED" as const,
        created_at: NOW,
        updated_at: NOW,
      };

      await expect(svc.refundIntent(intent, refund)).rejects.toThrow(
        "refund requires SETTLED intent, got AUTHORIZED",
      );
    });

    it("throws when refund amount exceeds payment amount", async () => {
      const svc = new PaymentService({ x402: new MockX402Adapter() });
      const intent = makeIntent({ status: "SETTLED", amount: { currency: "USDC", amount_minor: 100_00 } });
      const refund = {
        id: "ref_guard_002",
        payment_intent_id: intent.id,
        amount: { currency: "USDC", amount_minor: 150_00 },
        reason_code: "customer_request",
        status: "REQUESTED" as const,
        created_at: NOW,
        updated_at: NOW,
      };

      await expect(svc.refundIntent(intent, refund)).rejects.toThrow(
        "refund amount 15000 exceeds payment amount 10000",
      );
    });

    it("allows valid refund when SETTLED and amount within limit", async () => {
      const svc = new PaymentService({ x402: new MockX402Adapter() });
      const intent = makeIntent({ status: "SETTLED", amount: { currency: "USDC", amount_minor: 100_00 } });
      const refund = {
        id: "ref_guard_003",
        payment_intent_id: intent.id,
        amount: { currency: "USDC", amount_minor: 50_00 },
        reason_code: "customer_request",
        status: "REQUESTED" as const,
        created_at: NOW,
        updated_at: NOW,
      };

      const result = await svc.refundIntent(intent, refund);
      expect(result.refund.status).toBe("COMPLETED");
    });
  });

  describe("refund", () => {
    it("refunds via x402 adapter", async () => {
      const svc = new PaymentService({ x402: new MockX402Adapter() });
      const intent = makeIntent({ status: "SETTLED" });
      const refund = {
        id: "ref_001",
        payment_intent_id: intent.id,
        amount: { currency: "USDC", amount_minor: 50_00 },
        reason_code: "customer_request",
        status: "REQUESTED" as const,
        created_at: NOW,
        updated_at: NOW,
      };

      const result = await svc.refundIntent(intent, refund);
      expect(result.refund.status).toBe("COMPLETED");
      expect(result.metadata).toHaveProperty("provider_reference");
    });

    it("refunds via stripe adapter", async () => {
      const svc = new PaymentService({ stripe: new MockStripeAdapter() });
      const intent = makeIntent({ status: "SETTLED", selected_rail: "stripe" });
      const refund = {
        id: "ref_002",
        payment_intent_id: intent.id,
        amount: { currency: "USD", amount_minor: 25_00 },
        reason_code: "defective_item",
        status: "REQUESTED" as const,
        created_at: NOW,
        updated_at: NOW,
      };

      const result = await svc.refundIntent(intent, refund);
      expect(result.refund.status).toBe("COMPLETED");
      expect(result.metadata).toHaveProperty("refund_id");
    });
  });

  describe("error cases", () => {
    it("throws when no provider registered for selected rail", async () => {
      const svc = new PaymentService({});
      const intent = makeIntent();

      await expect(svc.quoteIntent(intent)).rejects.toThrow(
        "no payment provider registered for rail: x402",
      );
    });

    it("throws when provider missing for authorize", async () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "QUOTED" });

      await expect(svc.authorizeIntent(intent)).rejects.toThrow(
        "no payment provider registered for rail",
      );
    });

    it("throws when provider missing for settle", async () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "SETTLEMENT_PENDING" });

      await expect(svc.settleIntent(intent)).rejects.toThrow(
        "no payment provider registered for rail",
      );
    });

    it("throws when provider missing for refund", async () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "SETTLED" });
      const refund = {
        id: "ref_003",
        payment_intent_id: intent.id,
        amount: { currency: "USDC", amount_minor: 10_00 },
        reason_code: "test",
        status: "REQUESTED" as const,
        created_at: NOW,
        updated_at: NOW,
      };

      await expect(svc.refundIntent(intent, refund)).rejects.toThrow(
        "no payment provider registered for rail",
      );
    });

    it("throws on invalid state transition during quote", async () => {
      const svc = new PaymentService({ x402: new MockX402Adapter() });
      const intent = makeIntent({ status: "SETTLED" });

      await expect(svc.quoteIntent(intent)).rejects.toThrow("invalid payment transition");
    });

    it("throws on invalid state transition during authorize", async () => {
      const svc = new PaymentService({ x402: new MockX402Adapter() });
      const intent = makeIntent({ status: "SETTLEMENT_PENDING" });

      await expect(svc.authorizeIntent(intent)).rejects.toThrow("invalid payment transition");
    });

    it("throws on invalid state transition during settle", async () => {
      const svc = new PaymentService({ x402: new MockX402Adapter() });
      const intent = makeIntent({ status: "AUTHORIZED" });

      // AUTHORIZED -> settle is invalid (must go through SETTLEMENT_PENDING)
      await expect(svc.settleIntent(intent)).rejects.toThrow("invalid payment transition");
    });

    it("throws on invalid state transition during markSettlementPending", () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "CREATED" });

      expect(() => svc.markSettlementPending(intent)).toThrow("invalid payment transition");
    });
  });

  describe("updated_at tracking", () => {
    it("updates the updated_at timestamp on state transitions", () => {
      const svc = new PaymentService({});
      const intent = makeIntent({ status: "CREATED", updated_at: "2026-01-01T00:00:00.000Z" });
      const laterTime = "2026-01-15T18:30:00.000Z";

      const result = svc.cancelIntent(intent, laterTime);
      expect(result.intent.updated_at).toBe(laterTime);
      expect(result.intent.created_at).toBe(intent.created_at); // unchanged
    });
  });

  describe("multi-provider service", () => {
    it("routes to correct provider based on selected_rail", async () => {
      const svc = new PaymentService({
        x402: new MockX402Adapter(),
        stripe: new MockStripeAdapter(),
      });

      const x402Intent = svc.createIntent({
        order_id: "ord_400",
        seller_id: "s1",
        buyer_id: "b1",
        selected_rail: "x402",
        amount: { currency: "USDC", amount_minor: 100_00 },
      });

      const stripeIntent = svc.createIntent({
        order_id: "ord_401",
        seller_id: "s1",
        buyer_id: "b1",
        selected_rail: "stripe",
        amount: { currency: "USD", amount_minor: 100_00 },
      });

      const x402Quote = await svc.quoteIntent(x402Intent);
      const stripeQuote = await svc.quoteIntent(stripeIntent);

      expect(x402Quote.value!.rail).toBe("x402");
      expect(stripeQuote.value!.rail).toBe("stripe");

      expect(x402Quote.value!.metadata).toHaveProperty("network");
      expect(stripeQuote.value!.metadata).toHaveProperty("payment_method_types");
    });
  });
});

// ===========================================================================
// 6. Mock Adapters
// ===========================================================================

describe("MockX402Adapter", () => {
  const adapter = new MockX402Adapter();

  it("has correct rail and provider", () => {
    expect(adapter.rail).toBe("x402");
    expect(adapter.provider).toBe("ai.haggle.x402.mock");
  });

  it("quote returns metadata with network and settlement_mode", async () => {
    const intent = makeIntent();
    const quote = await adapter.quote(intent);
    expect(quote.rail).toBe("x402");
    expect(quote.amount).toEqual(intent.amount);
    expect(quote.metadata?.network).toBe("base-sepolia");
    expect(quote.metadata?.settlement_mode).toBe("mock");
    expect(quote.expires_at).toBeDefined();
  });

  it("authorize returns authorization with mock signer", async () => {
    const intent = makeIntent();
    const result = await adapter.authorize(intent);
    expect(result.authorization.payment_intent_id).toBe(intent.id);
    expect(result.authorization.rail).toBe("x402");
    expect(result.metadata?.signer).toBe("mock-buyer-wallet");
  });

  it("settle returns settlement with tx_hash", async () => {
    const intent = makeIntent();
    const result = await adapter.settle(intent);
    expect(result.settlement.payment_intent_id).toBe(intent.id);
    expect(result.settlement.status).toBe("SETTLED");
    expect(result.metadata?.tx_hash).toBeDefined();
    expect((result.metadata?.tx_hash as string).startsWith("0x")).toBe(true);
  });

  it("refund returns completed refund", async () => {
    const intent = makeIntent();
    const refund = {
      id: "ref_x",
      payment_intent_id: intent.id,
      amount: { currency: "USDC", amount_minor: 10_00 },
      reason_code: "test",
      status: "REQUESTED" as const,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const result = await adapter.refund(intent, refund);
    expect(result.refund.status).toBe("COMPLETED");
    expect(result.refund.id).toBe("ref_x");
  });
});

describe("MockStripeAdapter", () => {
  const adapter = new MockStripeAdapter();

  it("has correct rail and provider", () => {
    expect(adapter.rail).toBe("stripe");
    expect(adapter.provider).toBe("ai.haggle.stripe.mock");
  });

  it("quote returns metadata with payment_method_types", async () => {
    const intent = makeIntent({ selected_rail: "stripe" });
    const quote = await adapter.quote(intent);
    expect(quote.rail).toBe("stripe");
    expect(quote.metadata?.payment_method_types).toEqual(["card"]);
  });

  it("authorize returns metadata with payment_intent_secret", async () => {
    const intent = makeIntent({ selected_rail: "stripe" });
    const result = await adapter.authorize(intent);
    expect(result.authorization.rail).toBe("stripe");
    expect(result.metadata?.payment_intent_secret).toBeDefined();
  });

  it("settle returns metadata with charge_id", async () => {
    const intent = makeIntent({ selected_rail: "stripe" });
    const result = await adapter.settle(intent);
    expect(result.settlement.status).toBe("SETTLED");
    expect(result.metadata?.charge_id).toBeDefined();
  });
});
