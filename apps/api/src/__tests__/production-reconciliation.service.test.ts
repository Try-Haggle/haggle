import { describe, expect, it } from "vitest";
import { buildProductionReconciliationReport } from "../services/production-reconciliation.service.js";

describe("production reconciliation report service", () => {
  it("combines payment, shipment, and dispute findings into a report-only summary", () => {
    const report = buildProductionReconciliationReport({
      generatedAt: "2026-05-12T00:00:00.000Z",
      payments: {
        local: [{
          payment_intent_id: "pi_1",
          order_id: "ord_1",
          state: "authorized",
          amount_minor: 1000,
          provider_reference: "prov_1",
        }],
        provider: [{
          provider_reference: "prov_1",
          state: "captured",
          amount_minor: 1000,
        }],
      },
      shipments: {
        local: [{
          shipment_id: "ship_1",
          order_id: "ord_1",
          state: "label_created",
          order_status: "PAYMENT_PENDING",
        }],
        provider: [],
      },
      disputes: {
        local: [{
          dispute_id: "disp_1",
          order_id: "ord_1",
          status: "resolved_buyer_favor",
          outcome: "buyer_favor",
          order_status: "IN_DISPUTE",
          refund_status: "PENDING",
        }],
      },
    });

    expect(report.reportOnly).toBe(true);
    expect(report.generatedAt).toBe("2026-05-12T00:00:00.000Z");
    expect(report.summary).toEqual({
      critical: 4,
      warning: 2,
      total: 6,
      payments: 1,
      shipments: 2,
      disputes: 3,
    });
    expect(report.findings.payments.map((finding) => finding.type)).toEqual([
      "provider_captured_local_not_captured",
    ]);
    expect(report.findings.shipments.map((finding) => finding.type)).toEqual([
      "label_created_without_fulfillable_order",
      "tracking_missing_after_label",
    ]);
    expect(report.findings.disputes.map((finding) => finding.type)).toEqual([
      "resolved_buyer_favor_without_refund",
      "resolved_dispute_order_not_terminal",
      "resolved_dispute_missing_finalization_marker",
    ]);
    expect(report.nextActions).toContain(
      "Refresh local payment/order state from provider truth and audit the correction.",
    );
  });
});
