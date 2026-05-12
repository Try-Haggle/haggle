import { describe, expect, it } from "vitest";
import { detectDisputeFinalizationFindings } from "../production-readiness.js";

describe("dispute production readiness helpers", () => {
  it("detects unresolved financial side effects after dispute resolution", () => {
    const findings = detectDisputeFinalizationFindings([
      {
        dispute_id: "disp_buyer",
        order_id: "ord_buyer",
        status: "resolved_buyer_favor",
        outcome: "buyer_favor",
        order_status: "IN_DISPUTE",
        refund_status: "PENDING",
        return_shipment_status: "RETURN_IN_TRANSIT",
        finalization_attempts: 2,
      },
      {
        dispute_id: "disp_partial",
        order_id: "ord_partial",
        status: "partial_refund",
        outcome: "partial_refund",
        order_status: "REFUNDED",
        refund_status: "COMPLETED",
        refund_amount_minor: 500,
        expected_refund_amount_minor: 700,
        finalized_at: "2026-05-12T00:00:00.000Z",
      },
      {
        dispute_id: "disp_seller",
        order_id: "ord_seller",
        status: "resolved_seller_favor",
        outcome: "seller_favor",
        order_status: "CLOSED",
        settlement_release_status: "PENDING",
        finalized_at: "2026-05-12T00:00:00.000Z",
      },
    ]);

    expect(findings.map((finding) => finding.type)).toEqual([
      "partial_refund_missing_or_amount_mismatch",
      "resolved_buyer_favor_without_refund",
      "resolved_dispute_order_not_terminal",
      "resolved_seller_favor_without_release",
      "excessive_finalization_attempts",
      "resolved_dispute_missing_finalization_marker",
      "return_required_before_refund",
    ]);
    expect(findings.every((finding) => finding.recommended_action.length > 0)).toBe(true);
  });

  it("does not flag fully finalized buyer and seller outcomes", () => {
    expect(detectDisputeFinalizationFindings([
      {
        dispute_id: "disp_refunded",
        order_id: "ord_refunded",
        status: "resolved_buyer_favor",
        outcome: "buyer_favor",
        order_status: "REFUNDED",
        refund_status: "COMPLETED",
        return_shipment_status: "RETURNED",
        finalized_at: "2026-05-12T00:00:00.000Z",
      },
      {
        dispute_id: "disp_released",
        order_id: "ord_released",
        status: "resolved_seller_favor",
        outcome: "seller_favor",
        order_status: "CLOSED",
        settlement_release_status: "RELEASED",
        finalized_at: "2026-05-12T00:00:00.000Z",
      },
    ])).toEqual([]);
  });
});
