import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import {
  buildProductionReconciliationReport,
  collectProductionReconciliationInput,
} from "../services/production-reconciliation.service.js";

function createSelectQueueDb(rowsBySelect: unknown[][]): Database {
  const queue = [...rowsBySelect];
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => queue.shift() ?? []),
        })),
      })),
    })),
  } as unknown as Database;
}

describe("production reconciliation report service", () => {
  it("combines payment, shipment, and dispute findings into a report-only summary", () => {
    const report = buildProductionReconciliationReport({
      generatedAt: "2026-05-12T00:00:00.000Z",
      payments: {
        local: [
          {
            payment_intent_id: "pi_1",
            order_id: "ord_1",
            state: "authorized",
            amount_minor: 1000,
            provider_reference: "prov_1",
          },
        ],
        provider: [
          {
            provider_reference: "prov_1",
            state: "captured",
            amount_minor: 1000,
          },
        ],
      },
      shipments: {
        local: [
          {
            shipment_id: "ship_1",
            order_id: "ord_1",
            state: "label_created",
            order_status: "PAYMENT_PENDING",
          },
        ],
        provider: [],
      },
      disputes: {
        local: [
          {
            dispute_id: "disp_1",
            order_id: "ord_1",
            status: "resolved_buyer_favor",
            outcome: "buyer_favor",
            order_status: "IN_DISPUTE",
            refund_status: "PENDING",
          },
        ],
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

  it("collects local payment, shipment, and dispute snapshots without mutating state", async () => {
    const db = createSelectQueueDb([
      [
        {
          id: "pi_1",
          orderId: "ord_1",
          status: "SETTLED",
          amountMinor: "1000",
        },
      ],
      [
        {
          paymentIntentId: "pi_1",
          providerReference: "provider_payment_1",
        },
      ],
      [],
      [
        {
          paymentIntentId: "pi_1",
          status: "COMPLETED",
          amountMinor: "250",
        },
      ],
      [
        {
          id: "ship_1",
          orderId: "ord_1",
          status: "LABEL_CREATED",
          carrier: "USPS",
          trackingNumber: null,
          labelUrl: null,
          metadata: {
            easypost_shipment_id: "easypost_ship_1",
            label_qr_code_url: "https://labels.test/qr.png",
          },
        },
      ],
      [
        {
          id: "ord_1",
          status: "PAID",
        },
      ],
      [
        {
          id: "disp_1",
          orderId: "ord_1",
          status: "RESOLVED_SELLER_FAVOR",
          metadata: {
            finalization_attempts: 2,
          },
          resolvedAt: new Date("2026-05-12T00:00:00.000Z"),
          closedAt: null,
        },
      ],
      [
        {
          disputeId: "disp_1",
          outcome: "seller_favor",
          refundAmountMinor: null,
        },
      ],
      [
        {
          id: "ord_1",
          status: "CLOSED",
        },
      ],
      [
        {
          id: "pi_1",
          orderId: "ord_1",
        },
      ],
      [],
      [
        {
          orderId: "ord_1",
          productReleaseStatus: "PENDING_DELIVERY",
        },
      ],
      [],
    ]);
    const listPaymentProviderSnapshots = vi.fn(async () => [
      {
        provider_reference: "provider_payment_1",
        state: "refunded" as const,
        amount_minor: 1000,
        refunded_amount_minor: 250,
      },
    ]);
    const listShipmentProviderSnapshots = vi.fn(async () => [
      {
        provider_shipment_id: "easypost_ship_1",
        state: "label_created" as const,
        label_purchased: true,
      },
    ]);

    const input = await collectProductionReconciliationInput(db, {
      limit: 10,
      generatedAt: "2026-05-12T00:00:00.000Z",
      providerSource: {
        listPaymentProviderSnapshots,
        listShipmentProviderSnapshots,
      },
    });

    expect(input.generatedAt).toBe("2026-05-12T00:00:00.000Z");
    expect(input.payments?.local).toEqual([
      {
        payment_intent_id: "pi_1",
        order_id: "ord_1",
        state: "partially_refunded",
        amount_minor: 1000,
        refunded_amount_minor: 250,
        provider_reference: "provider_payment_1",
      },
    ]);
    expect(input.shipments?.local).toEqual([
      {
        shipment_id: "ship_1",
        order_id: "ord_1",
        state: "label_created",
        carrier: "USPS",
        tracking_number: undefined,
        provider_shipment_id: "easypost_ship_1",
        provider_tracker_id: undefined,
        label_url: undefined,
        qr_code_url: "https://labels.test/qr.png",
        order_status: "PAID",
      },
    ]);
    expect(input.disputes?.local).toEqual([
      {
        dispute_id: "disp_1",
        order_id: "ord_1",
        status: "resolved_seller_favor",
        outcome: "seller_favor",
        order_status: "CLOSED",
        refund_status: undefined,
        refund_amount_minor: undefined,
        expected_refund_amount_minor: undefined,
        settlement_release_status: "PENDING_DELIVERY",
        return_shipment_status: undefined,
        finalized_at: "2026-05-12T00:00:00.000Z",
        finalization_attempts: 2,
      },
    ]);
    expect(listPaymentProviderSnapshots).toHaveBeenCalledWith(input.payments?.local);
    expect(listShipmentProviderSnapshots).toHaveBeenCalledWith(input.shipments?.local);
  });

  it("omits payment findings when provider payment source is not configured", async () => {
    const input = await collectProductionReconciliationInput(
      createSelectQueueDb([
        [
          {
            id: "pi_1",
            orderId: "ord_1",
            status: "SETTLED",
            amountMinor: "1000",
          },
        ],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
      ]),
    );

    expect(input.payments).toBeUndefined();
    expect(input.shipments).toEqual({ local: [], provider: [] });
    expect(input.disputes).toEqual({ local: [] });
  });
});
