import { describe, expect, it } from "vitest";
import {
  calculateCarrierRetryDelayMs,
  classifyCarrierError,
  detectShipmentReconciliationFindings,
  redactShippingSensitiveData,
} from "../production-readiness.js";

describe("shipping production readiness helpers", () => {
  it("redacts shipping PII and carrier secrets recursively", () => {
    expect(
      redactShippingSensitiveData({
        carrier: "USPS",
        to_address: {
          name: "Buyer",
          street1: "1 Main St",
          city: "Denver",
          zip: "80202",
        },
        webhook_signature: "hmac-secret",
        nested: [{ phone: "555-0100", status: "DELIVERED" }],
      }),
    ).toEqual({
      carrier: "USPS",
      to_address: "[REDACTED]",
      webhook_signature: "[REDACTED]",
      nested: [{ phone: "[REDACTED]", status: "DELIVERED" }],
    });
  });

  it("handles circular objects and Error instances", () => {
    const value: Record<string, unknown> = { street1: "1 Main St" };
    value.self = value;

    expect(
      redactShippingSensitiveData({
        value,
        error: new Error("EasyPost secret leak"),
      }),
    ).toEqual({
      value: {
        street1: "[REDACTED]",
        self: "[Circular]",
      },
      error: {
        name: "Error",
        message: "[REDACTED_ERROR_MESSAGE]",
      },
    });
  });

  it("classifies carrier errors for bounded retries", () => {
    expect(classifyCarrierError({ status: 429 })).toBe("retryable");
    expect(classifyCarrierError({ statusCode: 503 })).toBe("retryable");
    expect(classifyCarrierError({ status: 401 })).toBe("non_retryable");
    expect(classifyCarrierError(new Error("request timed out"))).toBe("retryable");
    expect(classifyCarrierError(new Error("ambiguous carrier response"))).toBe(
      "unknown_requires_reconciliation",
    );
  });

  it("calculates bounded retry delay", () => {
    expect(calculateCarrierRetryDelayMs(0, { baseDelayMs: 100, maxDelayMs: 500 })).toBe(100);
    expect(calculateCarrierRetryDelayMs(2, { baseDelayMs: 100, maxDelayMs: 500 })).toBe(400);
    expect(calculateCarrierRetryDelayMs(10, { baseDelayMs: 100, maxDelayMs: 500 })).toBe(500);
  });

  it("detects shipment reconciliation drift without calling a carrier", () => {
    const findings = detectShipmentReconciliationFindings(
      [
        {
          shipment_id: "ship_unpaid",
          order_id: "ord_unpaid",
          state: "label_created",
          order_status: "PAYMENT_PENDING",
          provider_shipment_id: "ps_unpaid",
          label_url: "https://labels.example/1.pdf",
        },
        {
          shipment_id: "ship_label_asset_missing",
          order_id: "ord_label",
          state: "label_created",
          provider_shipment_id: "ps_label",
          tracking_number: "9400LABEL",
        },
        {
          shipment_id: "ship_provider_delivered",
          order_id: "ord_provider_delivered",
          state: "in_transit",
          provider_tracker_id: "trk_delivered",
          tracking_number: "9400DELIVERED",
          label_url: "https://labels.example/2.pdf",
        },
        {
          shipment_id: "ship_return",
          order_id: "ord_return",
          state: "return_in_transit",
          provider_tracker_id: "trk_return",
          tracking_number: "9400RETURN",
          label_url: "https://labels.example/3.pdf",
        },
      ],
      [
        {
          provider_shipment_id: "ps_label",
          tracking_number: "9400LABEL",
          state: "label_created",
          label_purchased: true,
        },
        {
          provider_tracker_id: "trk_delivered",
          tracking_number: "9400DELIVERED",
          state: "delivered",
        },
        {
          provider_tracker_id: "trk_return",
          tracking_number: "9400RETURN",
          state: "in_transit",
        },
        {
          provider_shipment_id: "ps_orphan",
          tracking_number: "9400ORPHAN",
          state: "delivered",
          label_purchased: true,
        },
      ],
    );

    expect(findings.map((finding) => finding.type)).toEqual([
      "label_created_without_fulfillable_order",
      "label_missing_after_provider_purchase",
      "orphan_provider_shipment",
      "provider_delivered_local_not_delivered",
      "return_state_mismatch",
      "tracking_missing_after_label",
    ]);
    expect(findings.every((finding) => finding.recommended_action.length > 0)).toBe(true);
  });
});
