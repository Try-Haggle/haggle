import { describe, it, expect } from "vitest";
import { transitionDisputeStatus } from "../state-machine.js";
import { DisputeService } from "../service.js";
import { trustTriggersForDisputeResolution } from "../trust-events.js";
import {
  REASON_CODE_REGISTRY,
  type DisputeReasonCode,
  type ReasonCodeMetadata,
} from "../reason-codes.js";
import { validateEvidenceForReasonCode } from "../evidence-validator.js";
import type { DisputeCase, DisputeEvidence, DisputeStatus } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpenCase(overrides?: Partial<DisputeCase>): DisputeCase {
  return {
    id: "dsp_test-001",
    order_id: "ord_test-001",
    reason_code: "ITEM_NOT_RECEIVED",
    status: "OPEN",
    opened_by: "buyer",
    opened_at: "2026-03-22T00:00:00.000Z",
    evidence: [],
    ...overrides,
  };
}

const service = new DisputeService();

// ===========================================================================
// 1. State Machine
// ===========================================================================

describe("transitionDisputeStatus", () => {
  // -----------------------------------------------------------------------
  // 1a. Valid transitions
  // -----------------------------------------------------------------------
  describe("valid transitions", () => {
    // OPEN transitions
    it("OPEN + review -> UNDER_REVIEW", () => {
      expect(transitionDisputeStatus("OPEN", "review")).toBe("UNDER_REVIEW");
    });

    it("OPEN + request_buyer_evidence -> WAITING_FOR_BUYER", () => {
      expect(transitionDisputeStatus("OPEN", "request_buyer_evidence")).toBe(
        "WAITING_FOR_BUYER",
      );
    });

    it("OPEN + request_seller_evidence -> WAITING_FOR_SELLER", () => {
      expect(transitionDisputeStatus("OPEN", "request_seller_evidence")).toBe(
        "WAITING_FOR_SELLER",
      );
    });

    // UNDER_REVIEW transitions
    it("UNDER_REVIEW + request_buyer_evidence -> WAITING_FOR_BUYER", () => {
      expect(
        transitionDisputeStatus("UNDER_REVIEW", "request_buyer_evidence"),
      ).toBe("WAITING_FOR_BUYER");
    });

    it("UNDER_REVIEW + request_seller_evidence -> WAITING_FOR_SELLER", () => {
      expect(
        transitionDisputeStatus("UNDER_REVIEW", "request_seller_evidence"),
      ).toBe("WAITING_FOR_SELLER");
    });

    it("UNDER_REVIEW + resolve_buyer_favor -> RESOLVED_BUYER_FAVOR", () => {
      expect(
        transitionDisputeStatus("UNDER_REVIEW", "resolve_buyer_favor"),
      ).toBe("RESOLVED_BUYER_FAVOR");
    });

    it("UNDER_REVIEW + resolve_seller_favor -> RESOLVED_SELLER_FAVOR", () => {
      expect(
        transitionDisputeStatus("UNDER_REVIEW", "resolve_seller_favor"),
      ).toBe("RESOLVED_SELLER_FAVOR");
    });

    it("UNDER_REVIEW + resolve_partial_refund -> PARTIAL_REFUND", () => {
      expect(
        transitionDisputeStatus("UNDER_REVIEW", "resolve_partial_refund"),
      ).toBe("PARTIAL_REFUND");
    });

    // WAITING_FOR_BUYER transitions
    it("WAITING_FOR_BUYER + review -> UNDER_REVIEW", () => {
      expect(transitionDisputeStatus("WAITING_FOR_BUYER", "review")).toBe(
        "UNDER_REVIEW",
      );
    });

    it("WAITING_FOR_BUYER + close -> CLOSED", () => {
      expect(transitionDisputeStatus("WAITING_FOR_BUYER", "close")).toBe(
        "CLOSED",
      );
    });

    // WAITING_FOR_SELLER transitions
    it("WAITING_FOR_SELLER + review -> UNDER_REVIEW", () => {
      expect(transitionDisputeStatus("WAITING_FOR_SELLER", "review")).toBe(
        "UNDER_REVIEW",
      );
    });

    it("WAITING_FOR_SELLER + close -> CLOSED", () => {
      expect(transitionDisputeStatus("WAITING_FOR_SELLER", "close")).toBe(
        "CLOSED",
      );
    });

    // Resolved states -> CLOSED
    it("RESOLVED_BUYER_FAVOR + close -> CLOSED", () => {
      expect(transitionDisputeStatus("RESOLVED_BUYER_FAVOR", "close")).toBe(
        "CLOSED",
      );
    });

    it("RESOLVED_SELLER_FAVOR + close -> CLOSED", () => {
      expect(transitionDisputeStatus("RESOLVED_SELLER_FAVOR", "close")).toBe(
        "CLOSED",
      );
    });

    it("PARTIAL_REFUND + close -> CLOSED", () => {
      expect(transitionDisputeStatus("PARTIAL_REFUND", "close")).toBe(
        "CLOSED",
      );
    });
  });

  // -----------------------------------------------------------------------
  // 1b. Invalid transitions return null
  // -----------------------------------------------------------------------
  describe("invalid transitions return null", () => {
    const allStatuses: DisputeStatus[] = [
      "OPEN",
      "UNDER_REVIEW",
      "WAITING_FOR_BUYER",
      "WAITING_FOR_SELLER",
      "RESOLVED_BUYER_FAVOR",
      "RESOLVED_SELLER_FAVOR",
      "PARTIAL_REFUND",
      "CLOSED",
    ];

    // CLOSED is a terminal state with no outgoing transitions
    const allEvents = [
      "review",
      "request_buyer_evidence",
      "request_seller_evidence",
      "resolve_buyer_favor",
      "resolve_seller_favor",
      "resolve_partial_refund",
      "close",
    ] as const;

    it("CLOSED has no valid outgoing transitions", () => {
      for (const event of allEvents) {
        expect(transitionDisputeStatus("CLOSED", event)).toBeNull();
      }
    });

    it("OPEN cannot resolve directly", () => {
      expect(transitionDisputeStatus("OPEN", "resolve_buyer_favor")).toBeNull();
      expect(
        transitionDisputeStatus("OPEN", "resolve_seller_favor"),
      ).toBeNull();
      expect(
        transitionDisputeStatus("OPEN", "resolve_partial_refund"),
      ).toBeNull();
    });

    it("OPEN cannot close directly", () => {
      expect(transitionDisputeStatus("OPEN", "close")).toBeNull();
    });

    it("WAITING_FOR_BUYER cannot resolve", () => {
      expect(
        transitionDisputeStatus("WAITING_FOR_BUYER", "resolve_buyer_favor"),
      ).toBeNull();
      expect(
        transitionDisputeStatus("WAITING_FOR_BUYER", "resolve_seller_favor"),
      ).toBeNull();
      expect(
        transitionDisputeStatus("WAITING_FOR_BUYER", "resolve_partial_refund"),
      ).toBeNull();
    });

    it("WAITING_FOR_SELLER cannot resolve", () => {
      expect(
        transitionDisputeStatus("WAITING_FOR_SELLER", "resolve_buyer_favor"),
      ).toBeNull();
      expect(
        transitionDisputeStatus("WAITING_FOR_SELLER", "resolve_seller_favor"),
      ).toBeNull();
      expect(
        transitionDisputeStatus("WAITING_FOR_SELLER", "resolve_partial_refund"),
      ).toBeNull();
    });

    it("RESOLVED_BUYER_FAVOR only allows close", () => {
      expect(
        transitionDisputeStatus("RESOLVED_BUYER_FAVOR", "review"),
      ).toBeNull();
      expect(
        transitionDisputeStatus(
          "RESOLVED_BUYER_FAVOR",
          "request_buyer_evidence",
        ),
      ).toBeNull();
      expect(
        transitionDisputeStatus(
          "RESOLVED_BUYER_FAVOR",
          "resolve_buyer_favor",
        ),
      ).toBeNull();
    });

    it("RESOLVED_SELLER_FAVOR only allows close", () => {
      expect(
        transitionDisputeStatus("RESOLVED_SELLER_FAVOR", "review"),
      ).toBeNull();
      expect(
        transitionDisputeStatus(
          "RESOLVED_SELLER_FAVOR",
          "request_seller_evidence",
        ),
      ).toBeNull();
    });

    it("PARTIAL_REFUND only allows close", () => {
      expect(
        transitionDisputeStatus("PARTIAL_REFUND", "review"),
      ).toBeNull();
      expect(
        transitionDisputeStatus("PARTIAL_REFUND", "resolve_buyer_favor"),
      ).toBeNull();
    });

    it("UNDER_REVIEW cannot review again", () => {
      expect(transitionDisputeStatus("UNDER_REVIEW", "review")).toBeNull();
    });

    it("UNDER_REVIEW cannot close directly", () => {
      expect(transitionDisputeStatus("UNDER_REVIEW", "close")).toBeNull();
    });

    // Waiting states cannot request evidence from the same party
    it("WAITING_FOR_BUYER cannot request buyer evidence again", () => {
      expect(
        transitionDisputeStatus("WAITING_FOR_BUYER", "request_buyer_evidence"),
      ).toBeNull();
    });

    it("WAITING_FOR_SELLER cannot request seller evidence again", () => {
      expect(
        transitionDisputeStatus(
          "WAITING_FOR_SELLER",
          "request_seller_evidence",
        ),
      ).toBeNull();
    });
  });
});

// ===========================================================================
// 2. DisputeService
// ===========================================================================

describe("DisputeService", () => {
  // -----------------------------------------------------------------------
  // 2a. openCase
  // -----------------------------------------------------------------------
  describe("openCase", () => {
    it("creates a dispute with OPEN status", () => {
      const result = service.openCase({
        order_id: "ord_123",
        reason_code: "ITEM_NOT_RECEIVED",
        opened_by: "buyer",
        now: "2026-03-22T10:00:00.000Z",
      });

      expect(result.dispute.status).toBe("OPEN");
      expect(result.dispute.order_id).toBe("ord_123");
      expect(result.dispute.reason_code).toBe("ITEM_NOT_RECEIVED");
      expect(result.dispute.opened_by).toBe("buyer");
      expect(result.dispute.opened_at).toBe("2026-03-22T10:00:00.000Z");
      expect(result.dispute.evidence).toHaveLength(0);
      expect(result.trust_triggers).toHaveLength(0);
    });

    it("generates a dispute id with dsp_ prefix", () => {
      const result = service.openCase({
        order_id: "ord_abc",
        reason_code: "OTHER",
        opened_by: "seller",
      });

      expect(result.dispute.id).toMatch(/^dsp_/);
    });

    it("attaches initial evidence when provided", () => {
      const result = service.openCase({
        order_id: "ord_456",
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        opened_by: "buyer",
        initial_evidence: [
          { submitted_by: "buyer", type: "text", text: "Item was damaged" },
          { submitted_by: "buyer", type: "image", uri: "https://img.example/1.jpg" },
        ],
        now: "2026-03-22T10:00:00.000Z",
      });

      expect(result.dispute.evidence).toHaveLength(2);
      expect(result.dispute.evidence[0].id).toMatch(/^evi_/);
      expect(result.dispute.evidence[0].dispute_id).toBe(result.dispute.id);
      expect(result.dispute.evidence[0].created_at).toBe(
        "2026-03-22T10:00:00.000Z",
      );
      expect(result.dispute.evidence[0].type).toBe("text");
      expect(result.dispute.evidence[0].text).toBe("Item was damaged");
      expect(result.dispute.evidence[1].type).toBe("image");
      expect(result.dispute.evidence[1].uri).toBe("https://img.example/1.jpg");
    });

    it("generates unique ids for each evidence item", () => {
      const result = service.openCase({
        order_id: "ord_789",
        reason_code: "COUNTERFEIT_CLAIM",
        opened_by: "buyer",
        initial_evidence: [
          { submitted_by: "buyer", type: "text", text: "a" },
          { submitted_by: "buyer", type: "text", text: "b" },
        ],
      });

      expect(result.dispute.evidence[0].id).not.toBe(
        result.dispute.evidence[1].id,
      );
    });

    it("system can open a dispute", () => {
      const result = service.openCase({
        order_id: "ord_sys",
        reason_code: "PAYMENT_NOT_COMPLETED",
        opened_by: "system",
      });

      expect(result.dispute.opened_by).toBe("system");
    });

    it("uses current time when now is not provided", () => {
      const before = new Date().toISOString();
      const result = service.openCase({
        order_id: "ord_time",
        reason_code: "OTHER",
        opened_by: "buyer",
      });
      const after = new Date().toISOString();

      expect(result.dispute.opened_at >= before).toBe(true);
      expect(result.dispute.opened_at <= after).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2b. startReview
  // -----------------------------------------------------------------------
  describe("startReview", () => {
    it("transitions OPEN -> UNDER_REVIEW", () => {
      const dispute = makeOpenCase();
      const result = service.startReview(dispute);

      expect(result.dispute.status).toBe("UNDER_REVIEW");
      expect(result.trust_triggers).toHaveLength(0);
    });

    it("throws on invalid transition (e.g. CLOSED)", () => {
      const dispute = makeOpenCase({ status: "CLOSED" });
      expect(() => service.startReview(dispute)).toThrow(
        /invalid dispute transition/,
      );
    });

    it("throws on UNDER_REVIEW -> review (already under review)", () => {
      const dispute = makeOpenCase({ status: "UNDER_REVIEW" });
      expect(() => service.startReview(dispute)).toThrow(
        /invalid dispute transition/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 2c. requestBuyerEvidence / requestSellerEvidence
  // -----------------------------------------------------------------------
  describe("requestBuyerEvidence", () => {
    it("transitions OPEN -> WAITING_FOR_BUYER", () => {
      const dispute = makeOpenCase();
      const result = service.requestBuyerEvidence(dispute);

      expect(result.dispute.status).toBe("WAITING_FOR_BUYER");
    });

    it("transitions UNDER_REVIEW -> WAITING_FOR_BUYER", () => {
      const dispute = makeOpenCase({ status: "UNDER_REVIEW" });
      const result = service.requestBuyerEvidence(dispute);

      expect(result.dispute.status).toBe("WAITING_FOR_BUYER");
    });

    it("throws from RESOLVED_BUYER_FAVOR", () => {
      const dispute = makeOpenCase({ status: "RESOLVED_BUYER_FAVOR" });
      expect(() => service.requestBuyerEvidence(dispute)).toThrow(
        /invalid dispute transition/,
      );
    });
  });

  describe("requestSellerEvidence", () => {
    it("transitions OPEN -> WAITING_FOR_SELLER", () => {
      const dispute = makeOpenCase();
      const result = service.requestSellerEvidence(dispute);

      expect(result.dispute.status).toBe("WAITING_FOR_SELLER");
    });

    it("transitions UNDER_REVIEW -> WAITING_FOR_SELLER", () => {
      const dispute = makeOpenCase({ status: "UNDER_REVIEW" });
      const result = service.requestSellerEvidence(dispute);

      expect(result.dispute.status).toBe("WAITING_FOR_SELLER");
    });

    it("throws from CLOSED", () => {
      const dispute = makeOpenCase({ status: "CLOSED" });
      expect(() => service.requestSellerEvidence(dispute)).toThrow(
        /invalid dispute transition/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 2d. addEvidence
  // -----------------------------------------------------------------------
  describe("addEvidence", () => {
    it("appends evidence to the dispute", () => {
      const dispute = makeOpenCase();
      const result = service.addEvidence(
        dispute,
        { submitted_by: "buyer", type: "text", text: "Proof of purchase" },
        "2026-03-22T11:00:00.000Z",
      );

      expect(result.dispute.evidence).toHaveLength(1);
      expect(result.value).toBeDefined();
      expect(result.value!.id).toMatch(/^evi_/);
      expect(result.value!.dispute_id).toBe(dispute.id);
      expect(result.value!.submitted_by).toBe("buyer");
      expect(result.value!.type).toBe("text");
      expect(result.value!.text).toBe("Proof of purchase");
      expect(result.value!.created_at).toBe("2026-03-22T11:00:00.000Z");
      expect(result.trust_triggers).toHaveLength(0);
    });

    it("preserves existing evidence", () => {
      const existing = makeOpenCase({
        evidence: [
          {
            id: "evi_existing",
            dispute_id: "dsp_test-001",
            submitted_by: "buyer",
            type: "text",
            text: "first",
            created_at: "2026-03-22T00:00:00.000Z",
          },
        ],
      });

      const result = service.addEvidence(existing, {
        submitted_by: "seller",
        type: "image",
        uri: "https://img.example/response.jpg",
      });

      expect(result.dispute.evidence).toHaveLength(2);
      expect(result.dispute.evidence[0].id).toBe("evi_existing");
      expect(result.dispute.evidence[1].submitted_by).toBe("seller");
    });

    it("does not mutate the original dispute", () => {
      const dispute = makeOpenCase();
      service.addEvidence(dispute, {
        submitted_by: "buyer",
        type: "text",
        text: "new",
      });

      expect(dispute.evidence).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 2e. resolve
  // -----------------------------------------------------------------------
  describe("resolve", () => {
    it("resolves buyer_favor from UNDER_REVIEW", () => {
      const dispute = makeOpenCase({ status: "UNDER_REVIEW" });
      const result = service.resolve(
        dispute,
        {
          outcome: "buyer_favor",
          summary: "Item was defective, full refund granted",
          refund_amount_minor: 15000,
        },
        "2026-03-22T12:00:00.000Z",
      );

      expect(result.dispute.status).toBe("RESOLVED_BUYER_FAVOR");
      expect(result.dispute.resolution).toBeDefined();
      expect(result.dispute.resolution!.outcome).toBe("buyer_favor");
      expect(result.dispute.resolution!.summary).toBe(
        "Item was defective, full refund granted",
      );
      expect(result.dispute.resolution!.refund_amount_minor).toBe(15000);
      expect(result.dispute.resolution!.resolved_at).toBe(
        "2026-03-22T12:00:00.000Z",
      );
      expect(result.value).toBeDefined();
      expect(result.value!.outcome).toBe("buyer_favor");
    });

    it("resolves seller_favor from UNDER_REVIEW", () => {
      const dispute = makeOpenCase({ status: "UNDER_REVIEW" });
      const result = service.resolve(dispute, {
        outcome: "seller_favor",
        summary: "Item matched description",
      });

      expect(result.dispute.status).toBe("RESOLVED_SELLER_FAVOR");
    });

    it("resolves partial_refund from UNDER_REVIEW", () => {
      const dispute = makeOpenCase({ status: "UNDER_REVIEW" });
      const result = service.resolve(dispute, {
        outcome: "partial_refund",
        summary: "Minor defect, 30% refund",
        refund_amount_minor: 4500,
      });

      expect(result.dispute.status).toBe("PARTIAL_REFUND");
      expect(result.dispute.resolution!.refund_amount_minor).toBe(4500);
    });

    it("resolves no_action (maps to resolve_seller_favor)", () => {
      const dispute = makeOpenCase({ status: "UNDER_REVIEW" });
      const result = service.resolve(dispute, {
        outcome: "no_action",
        summary: "No action required",
      });

      expect(result.dispute.status).toBe("RESOLVED_SELLER_FAVOR");
    });

    it("emits trust triggers for buyer_favor resolution", () => {
      const dispute = makeOpenCase({ status: "UNDER_REVIEW" });
      const result = service.resolve(dispute, {
        outcome: "buyer_favor",
        summary: "Buyer wins",
      });

      expect(result.trust_triggers).toHaveLength(2);
      expect(result.trust_triggers).toContainEqual({
        module: "dispute",
        actor_role: "buyer",
        type: "dispute_win",
      });
      expect(result.trust_triggers).toContainEqual({
        module: "dispute",
        actor_role: "seller",
        type: "dispute_loss",
      });
    });

    it("emits trust triggers for seller_favor resolution", () => {
      const dispute = makeOpenCase({ status: "UNDER_REVIEW" });
      const result = service.resolve(dispute, {
        outcome: "seller_favor",
        summary: "Seller wins",
      });

      expect(result.trust_triggers).toHaveLength(2);
      expect(result.trust_triggers).toContainEqual({
        module: "dispute",
        actor_role: "seller",
        type: "dispute_win",
      });
      expect(result.trust_triggers).toContainEqual({
        module: "dispute",
        actor_role: "buyer",
        type: "dispute_loss",
      });
    });

    it("emits trust triggers for partial_refund resolution", () => {
      const dispute = makeOpenCase({ status: "UNDER_REVIEW" });
      const result = service.resolve(dispute, {
        outcome: "partial_refund",
        summary: "Split",
      });

      expect(result.trust_triggers).toHaveLength(2);
      expect(result.trust_triggers).toContainEqual({
        module: "dispute",
        actor_role: "buyer",
        type: "dispute_win",
      });
      expect(result.trust_triggers).toContainEqual({
        module: "dispute",
        actor_role: "seller",
        type: "dispute_loss",
      });
    });

    it("throws when resolving from OPEN (not yet reviewed)", () => {
      const dispute = makeOpenCase();
      expect(() =>
        service.resolve(dispute, {
          outcome: "buyer_favor",
          summary: "Skip review",
        }),
      ).toThrow(/invalid dispute transition/);
    });

    it("throws when resolving from CLOSED", () => {
      const dispute = makeOpenCase({ status: "CLOSED" });
      expect(() =>
        service.resolve(dispute, {
          outcome: "seller_favor",
          summary: "Too late",
        }),
      ).toThrow(/invalid dispute transition/);
    });
  });

  // -----------------------------------------------------------------------
  // 2f. closeCase
  // -----------------------------------------------------------------------
  describe("closeCase", () => {
    it("closes from RESOLVED_BUYER_FAVOR", () => {
      const dispute = makeOpenCase({ status: "RESOLVED_BUYER_FAVOR" });
      const result = service.closeCase(dispute);

      expect(result.dispute.status).toBe("CLOSED");
      expect(result.trust_triggers).toHaveLength(0);
    });

    it("closes from RESOLVED_SELLER_FAVOR", () => {
      const dispute = makeOpenCase({ status: "RESOLVED_SELLER_FAVOR" });
      const result = service.closeCase(dispute);

      expect(result.dispute.status).toBe("CLOSED");
    });

    it("closes from PARTIAL_REFUND", () => {
      const dispute = makeOpenCase({ status: "PARTIAL_REFUND" });
      const result = service.closeCase(dispute);

      expect(result.dispute.status).toBe("CLOSED");
    });

    it("closes from WAITING_FOR_BUYER (timeout/abandonment)", () => {
      const dispute = makeOpenCase({ status: "WAITING_FOR_BUYER" });
      const result = service.closeCase(dispute);

      expect(result.dispute.status).toBe("CLOSED");
    });

    it("closes from WAITING_FOR_SELLER (timeout/abandonment)", () => {
      const dispute = makeOpenCase({ status: "WAITING_FOR_SELLER" });
      const result = service.closeCase(dispute);

      expect(result.dispute.status).toBe("CLOSED");
    });

    it("throws when closing from OPEN", () => {
      const dispute = makeOpenCase();
      expect(() => service.closeCase(dispute)).toThrow(
        /invalid dispute transition/,
      );
    });

    it("throws when closing from UNDER_REVIEW", () => {
      const dispute = makeOpenCase({ status: "UNDER_REVIEW" });
      expect(() => service.closeCase(dispute)).toThrow(
        /invalid dispute transition/,
      );
    });

    it("throws when closing already CLOSED dispute", () => {
      const dispute = makeOpenCase({ status: "CLOSED" });
      expect(() => service.closeCase(dispute)).toThrow(
        /invalid dispute transition/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 2g. Full lifecycle integration tests
  // -----------------------------------------------------------------------
  describe("full lifecycle", () => {
    it("OPEN -> UNDER_REVIEW -> RESOLVED_BUYER_FAVOR -> CLOSED", () => {
      const { dispute: d1 } = service.openCase({
        order_id: "ord_lifecycle_1",
        reason_code: "ITEM_NOT_RECEIVED",
        opened_by: "buyer",
        now: "2026-03-22T10:00:00.000Z",
      });

      expect(d1.status).toBe("OPEN");

      const { dispute: d2 } = service.startReview(d1);
      expect(d2.status).toBe("UNDER_REVIEW");

      const { dispute: d3, trust_triggers } = service.resolve(d2, {
        outcome: "buyer_favor",
        summary: "Full refund",
        refund_amount_minor: 10000,
      });
      expect(d3.status).toBe("RESOLVED_BUYER_FAVOR");
      expect(trust_triggers).toHaveLength(2);

      const { dispute: d4 } = service.closeCase(d3);
      expect(d4.status).toBe("CLOSED");
    });

    it("OPEN -> evidence request -> review -> resolve -> close", () => {
      const { dispute: d1 } = service.openCase({
        order_id: "ord_lifecycle_2",
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        opened_by: "buyer",
      });

      const { dispute: d2 } = service.requestBuyerEvidence(d1);
      expect(d2.status).toBe("WAITING_FOR_BUYER");

      const { dispute: d3 } = service.addEvidence(d2, {
        submitted_by: "buyer",
        type: "image",
        uri: "https://img.example/defect.jpg",
      });

      const { dispute: d4 } = service.startReview(d3);
      expect(d4.status).toBe("UNDER_REVIEW");

      const { dispute: d5 } = service.requestSellerEvidence(d4);
      expect(d5.status).toBe("WAITING_FOR_SELLER");

      const { dispute: d6 } = service.addEvidence(d5, {
        submitted_by: "seller",
        type: "text",
        text: "Item was shipped as described",
      });

      const { dispute: d7 } = service.startReview(d6);
      expect(d7.status).toBe("UNDER_REVIEW");
      expect(d7.evidence).toHaveLength(2);

      const { dispute: d8 } = service.resolve(d7, {
        outcome: "partial_refund",
        summary: "Partial defect confirmed",
        refund_amount_minor: 3000,
      });
      expect(d8.status).toBe("PARTIAL_REFUND");

      const { dispute: d9 } = service.closeCase(d8);
      expect(d9.status).toBe("CLOSED");
      expect(d9.evidence).toHaveLength(2);
      expect(d9.resolution!.refund_amount_minor).toBe(3000);
    });

    it("OPEN -> seller evidence -> close (abandonment path)", () => {
      const { dispute: d1 } = service.openCase({
        order_id: "ord_abandon",
        reason_code: "SELLER_NO_FULFILLMENT",
        opened_by: "system",
      });

      const { dispute: d2 } = service.requestSellerEvidence(d1);
      expect(d2.status).toBe("WAITING_FOR_SELLER");

      // Seller does not respond, system closes the case
      const { dispute: d3 } = service.closeCase(d2);
      expect(d3.status).toBe("CLOSED");
    });

    it("immutability: original dispute is never mutated", () => {
      const { dispute: original } = service.openCase({
        order_id: "ord_immut",
        reason_code: "OTHER",
        opened_by: "buyer",
      });

      const statusBefore = original.status;
      const evidenceLenBefore = original.evidence.length;

      service.startReview(original);
      service.addEvidence(original, {
        submitted_by: "buyer",
        type: "text",
        text: "test",
      });

      expect(original.status).toBe(statusBefore);
      expect(original.evidence.length).toBe(evidenceLenBefore);
    });
  });
});

// ===========================================================================
// 3. Trust Events
// ===========================================================================

describe("trustTriggersForDisputeResolution", () => {
  it("RESOLVED_BUYER_FAVOR -> buyer wins, seller loses", () => {
    const triggers = trustTriggersForDisputeResolution("RESOLVED_BUYER_FAVOR");

    expect(triggers).toHaveLength(2);
    expect(triggers).toContainEqual({
      module: "dispute",
      actor_role: "buyer",
      type: "dispute_win",
    });
    expect(triggers).toContainEqual({
      module: "dispute",
      actor_role: "seller",
      type: "dispute_loss",
    });
  });

  it("RESOLVED_SELLER_FAVOR -> seller wins, buyer loses", () => {
    const triggers = trustTriggersForDisputeResolution("RESOLVED_SELLER_FAVOR");

    expect(triggers).toHaveLength(2);
    expect(triggers).toContainEqual({
      module: "dispute",
      actor_role: "seller",
      type: "dispute_win",
    });
    expect(triggers).toContainEqual({
      module: "dispute",
      actor_role: "buyer",
      type: "dispute_loss",
    });
  });

  it("PARTIAL_REFUND returns buyer win + seller loss trust triggers", () => {
    const triggers = trustTriggersForDisputeResolution("PARTIAL_REFUND");
    expect(triggers).toHaveLength(2);
    expect(triggers).toContainEqual({
      module: "dispute",
      actor_role: "buyer",
      type: "dispute_win",
    });
    expect(triggers).toContainEqual({
      module: "dispute",
      actor_role: "seller",
      type: "dispute_loss",
    });
  });

  it("OPEN returns no trust triggers", () => {
    const triggers = trustTriggersForDisputeResolution("OPEN");
    expect(triggers).toHaveLength(0);
  });

  it("UNDER_REVIEW returns no trust triggers", () => {
    const triggers = trustTriggersForDisputeResolution("UNDER_REVIEW");
    expect(triggers).toHaveLength(0);
  });

  it("WAITING_FOR_BUYER returns no trust triggers", () => {
    const triggers = trustTriggersForDisputeResolution("WAITING_FOR_BUYER");
    expect(triggers).toHaveLength(0);
  });

  it("WAITING_FOR_SELLER returns no trust triggers", () => {
    const triggers = trustTriggersForDisputeResolution("WAITING_FOR_SELLER");
    expect(triggers).toHaveLength(0);
  });

  it("CLOSED returns no trust triggers", () => {
    const triggers = trustTriggersForDisputeResolution("CLOSED");
    expect(triggers).toHaveLength(0);
  });
});

// ===========================================================================
// 4. Reason Code Registry
// ===========================================================================

describe("REASON_CODE_REGISTRY", () => {
  const ALL_CODES: DisputeReasonCode[] = [
    "ITEM_NOT_RECEIVED",
    "ITEM_NOT_AS_DESCRIBED",
    "PAYMENT_NOT_COMPLETED",
    "SHIPMENT_SLA_MISSED",
    "DELIVERY_EXCEPTION",
    "SELLER_NO_FULFILLMENT",
    "REFUND_DISPUTE",
    "PARTIAL_REFUND_DISPUTE",
    "COUNTERFEIT_CLAIM",
    "OTHER",
  ];

  it("contains all 10 reason codes", () => {
    const registryKeys = Object.keys(REASON_CODE_REGISTRY);
    expect(registryKeys).toHaveLength(10);
    for (const code of ALL_CODES) {
      expect(REASON_CODE_REGISTRY[code]).toBeDefined();
    }
  });

  it("every entry has a self-referencing code field", () => {
    for (const [key, meta] of Object.entries(REASON_CODE_REGISTRY)) {
      expect(meta.code).toBe(key);
    }
  });

  it("every entry has a non-empty label", () => {
    for (const meta of Object.values(REASON_CODE_REGISTRY)) {
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a valid default_opener", () => {
    const validOpeners = ["buyer", "seller", "system"];
    for (const meta of Object.values(REASON_CODE_REGISTRY)) {
      expect(validOpeners).toContain(meta.default_opener);
    }
  });

  it("auto_open_eligible is a boolean for all entries", () => {
    for (const meta of Object.values(REASON_CODE_REGISTRY)) {
      expect(typeof meta.auto_open_eligible).toBe("boolean");
    }
  });

  it("requires_evidence_types is an array for all entries", () => {
    for (const meta of Object.values(REASON_CODE_REGISTRY)) {
      expect(Array.isArray(meta.requires_evidence_types)).toBe(true);
    }
  });

  describe("specific code metadata", () => {
    it("ITEM_NOT_RECEIVED is auto-open by buyer, requires tracking_snapshot", () => {
      const meta = REASON_CODE_REGISTRY.ITEM_NOT_RECEIVED;
      expect(meta.auto_open_eligible).toBe(true);
      expect(meta.default_opener).toBe("buyer");
      expect(meta.requires_evidence_types).toContain("tracking_snapshot");
    });

    it("ITEM_NOT_AS_DESCRIBED is not auto-open, requires text + image", () => {
      const meta = REASON_CODE_REGISTRY.ITEM_NOT_AS_DESCRIBED;
      expect(meta.auto_open_eligible).toBe(false);
      expect(meta.requires_evidence_types).toContain("text");
      expect(meta.requires_evidence_types).toContain("image");
    });

    it("PAYMENT_NOT_COMPLETED is auto-open by system, requires payment_proof", () => {
      const meta = REASON_CODE_REGISTRY.PAYMENT_NOT_COMPLETED;
      expect(meta.auto_open_eligible).toBe(true);
      expect(meta.default_opener).toBe("system");
      expect(meta.requires_evidence_types).toContain("payment_proof");
    });

    it("SHIPMENT_SLA_MISSED is auto-open by system, requires no evidence", () => {
      const meta = REASON_CODE_REGISTRY.SHIPMENT_SLA_MISSED;
      expect(meta.auto_open_eligible).toBe(true);
      expect(meta.default_opener).toBe("system");
      expect(meta.requires_evidence_types).toHaveLength(0);
    });

    it("DELIVERY_EXCEPTION is auto-open by system", () => {
      const meta = REASON_CODE_REGISTRY.DELIVERY_EXCEPTION;
      expect(meta.auto_open_eligible).toBe(true);
      expect(meta.default_opener).toBe("system");
    });

    it("SELLER_NO_FULFILLMENT is auto-open by system, requires no evidence", () => {
      const meta = REASON_CODE_REGISTRY.SELLER_NO_FULFILLMENT;
      expect(meta.auto_open_eligible).toBe(true);
      expect(meta.default_opener).toBe("system");
      expect(meta.requires_evidence_types).toHaveLength(0);
    });

    it("REFUND_DISPUTE is not auto-open, opened by buyer", () => {
      const meta = REASON_CODE_REGISTRY.REFUND_DISPUTE;
      expect(meta.auto_open_eligible).toBe(false);
      expect(meta.default_opener).toBe("buyer");
      expect(meta.requires_evidence_types).toContain("text");
      expect(meta.requires_evidence_types).toContain("payment_proof");
    });

    it("COUNTERFEIT_CLAIM is not auto-open, requires text + image", () => {
      const meta = REASON_CODE_REGISTRY.COUNTERFEIT_CLAIM;
      expect(meta.auto_open_eligible).toBe(false);
      expect(meta.requires_evidence_types).toContain("text");
      expect(meta.requires_evidence_types).toContain("image");
    });

    it("OTHER is a catch-all with text evidence", () => {
      const meta = REASON_CODE_REGISTRY.OTHER;
      expect(meta.auto_open_eligible).toBe(false);
      expect(meta.default_opener).toBe("buyer");
      expect(meta.requires_evidence_types).toEqual(["text"]);
    });
  });

  describe("auto-open eligibility grouping", () => {
    it("system-opened codes should be auto-open eligible", () => {
      const systemCodes = Object.values(REASON_CODE_REGISTRY).filter(
        (m) => m.default_opener === "system",
      );
      for (const meta of systemCodes) {
        expect(meta.auto_open_eligible).toBe(true);
      }
    });

    it("has exactly 5 auto-open eligible codes", () => {
      const autoOpenCodes = Object.values(REASON_CODE_REGISTRY).filter(
        (m) => m.auto_open_eligible,
      );
      expect(autoOpenCodes).toHaveLength(5);
    });

    it("has exactly 5 non-auto-open codes", () => {
      const manualCodes = Object.values(REASON_CODE_REGISTRY).filter(
        (m) => !m.auto_open_eligible,
      );
      expect(manualCodes).toHaveLength(5);
    });
  });
});

// ===========================================================================
// 5. Evidence Validator
// ===========================================================================

describe("validateEvidenceForReasonCode", () => {
  function makeEvidence(overrides: Partial<DisputeEvidence> & Pick<DisputeEvidence, "type">): DisputeEvidence {
    return {
      id: `evi_${Math.random().toString(36).slice(2, 8)}`,
      dispute_id: "dsp_test-001",
      submitted_by: "buyer",
      created_at: "2026-03-22T00:00:00.000Z",
      ...overrides,
    };
  }

  it("returns valid when all required evidence types are present", () => {
    const evidence: DisputeEvidence[] = [
      makeEvidence({ type: "text", text: "Item was damaged" }),
      makeEvidence({ type: "image", uri: "https://img.example/1.jpg" }),
    ];

    const result = validateEvidenceForReasonCode("ITEM_NOT_AS_DESCRIBED", evidence);
    expect(result.valid).toBe(true);
    expect(result.missing_types).toHaveLength(0);
  });

  it("returns invalid with missing required types", () => {
    // ITEM_NOT_AS_DESCRIBED requires text + image
    const evidence: DisputeEvidence[] = [
      makeEvidence({ type: "text", text: "Item was damaged" }),
    ];

    const result = validateEvidenceForReasonCode("ITEM_NOT_AS_DESCRIBED", evidence);
    expect(result.valid).toBe(false);
    expect(result.missing_types).toContain("image");
  });

  it("warns on empty text evidence", () => {
    const evidence: DisputeEvidence[] = [
      makeEvidence({ id: "evi_empty", type: "text", text: "" }),
      makeEvidence({ type: "image", uri: "https://img.example/1.jpg" }),
    ];

    const result = validateEvidenceForReasonCode("ITEM_NOT_AS_DESCRIBED", evidence);
    expect(result.warnings).toContain("evidence evi_empty is text type but has no content");
  });

  it("warns on text evidence with no text field", () => {
    const evidence: DisputeEvidence[] = [
      makeEvidence({ id: "evi_notext", type: "text" }),
      makeEvidence({ type: "image", uri: "https://img.example/1.jpg" }),
    ];

    const result = validateEvidenceForReasonCode("ITEM_NOT_AS_DESCRIBED", evidence);
    expect(result.warnings).toContain("evidence evi_notext is text type but has no content");
  });

  it("warns on image evidence with no URI", () => {
    const evidence: DisputeEvidence[] = [
      makeEvidence({ type: "text", text: "Damaged item" }),
      makeEvidence({ id: "evi_noimg", type: "image" }),
    ];

    const result = validateEvidenceForReasonCode("ITEM_NOT_AS_DESCRIBED", evidence);
    expect(result.warnings).toContain("evidence evi_noimg is image type but has no URI");
  });

  it("handles unknown reason code", () => {
    const result = validateEvidenceForReasonCode(
      "NONEXISTENT_CODE" as any,
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.warnings).toContain("unknown reason code: NONEXISTENT_CODE");
  });

  it("returns valid for reason codes with no required evidence", () => {
    // SHIPMENT_SLA_MISSED requires no evidence
    const result = validateEvidenceForReasonCode("SHIPMENT_SLA_MISSED", []);

    expect(result.valid).toBe(true);
    expect(result.missing_types).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
