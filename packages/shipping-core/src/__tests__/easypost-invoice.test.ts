import { describe, expect, it } from "vitest";
import { parseEasyPostInvoicePayload } from "../easypost-webhook.js";

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    description: "shipment_invoice.created",
    result: {
      id: "shinv_001",
      shipment_id: "shp_001",
      tracking_code: "TRACK001",
      original_rate: "6.25",
      charges: [{ type: "shipping", amount: "8.00" }],
      ...overrides,
    },
  };
}

describe("parseEasyPostInvoicePayload", () => {
  it("preserves invoice identity and computes a positive adjustment", () => {
    expect(parseEasyPostInvoicePayload(invoice())).toEqual({
      invoice_event: "created",
      invoice_id: "shinv_001",
      shipment_id: "shp_001",
      tracking_code: "TRACK001",
      original_rate_minor: 625,
      adjusted_rate_minor: 800,
      adjustment_minor: 175,
    });
  });

  it("accepts the official dotted EasyPost invoice event name", () => {
    expect(
      parseEasyPostInvoicePayload({
        ...invoice(),
        description: "shipment.invoice.updated",
      })?.invoice_event,
    ).toBe("updated");
  });

  it("preserves a carrier credit as a negative adjustment", () => {
    expect(
      parseEasyPostInvoicePayload(
        invoice({
          charges: [{ type: "shipping", amount: "5.25" }],
        }),
      )?.adjustment_minor,
    ).toBe(-100);
  });

  it("rejects an invoice without a stable provider invoice id", () => {
    expect(parseEasyPostInvoicePayload(invoice({ id: undefined }))).toBeNull();
  });

  it.each(["-1", "Infinity", "100000.01"])("rejects unsafe charge amount %s", (amount) => {
    expect(
      parseEasyPostInvoicePayload(
        invoice({
          charges: [{ type: "shipping", amount }],
        }),
      ),
    ).toBeNull();
  });

  it("rejects invoice payloads without a shipping charge", () => {
    expect(
      parseEasyPostInvoicePayload(
        invoice({
          charges: [{ type: "insurance", amount: "2.00" }],
        }),
      ),
    ).toBeNull();
  });
});
