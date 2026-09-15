import { SOFT_AGREEMENT_ACK_SOURCE_BUYER_UI_CTA, SOFT_AGREEMENT_ACK_VERSION } from "@haggle/shared";
import { describe, expect, it } from "vitest";
import {
  buildCheckoutAgreementDisplay,
  getSoftAgreementAckError,
  isCheckoutAgreementRenderable,
} from "../services/checkout-full-agreement.js";

describe("buildCheckoutAgreementDisplay", () => {
  it("builds full ship terms with disclosed fees from fee-policy bps", () => {
    const display = buildCheckoutAgreementDisplay({
      finalAmountMinor: 10_000,
      currency: "USD",
      termsSnapshot: {
        fulfillment_type: "physical_shipping",
        fulfillment_method: "carrier",
        shipping_cost_minor: 500,
        buyer_shipping_address: {
          name: "Ada Lovelace",
          street1: "123 Main St",
          city: "Denver",
          state: "CO",
          zip: "80202",
          country: "US",
        },
      },
    });
    expect(display.price_minor).toBe(10_000);
    expect(display.address.kind).toBe("delivery");
    expect(display.address.lines[0]).toBe("Ada Lovelace");
    expect(display.address.lines.some((l) => l.includes("123 Main St"))).toBe(true);
    expect(display.fees.haggle_fee_bps).toBe(150);
    expect(display.fees.card_buyer_total_bps).toBe(300);
    expect(display.fees.haggle_fee_minor).toBe(150);
    expect(display.fees.card_fee_minor).toBe(300);
    expect(display.fees.buyer_pays_wallet_minor).toBe(10_000 + 500 + 150);
    expect(display.terms_hash.startsWith("sha256:")).toBe(true);
    expect(isCheckoutAgreementRenderable(display)).toBe(true);
  });

  it("marks digital fulfillment address as N/A", () => {
    const display = buildCheckoutAgreementDisplay({
      finalAmountMinor: 10_000,
      currency: "USD",
      termsSnapshot: { fulfillment_type: "digital_delivery" },
    });
    expect(display.address.kind).toBe("none");
    expect(display.address.lines).toEqual(["N/A"]);
    expect(isCheckoutAgreementRenderable(display)).toBe(true);
  });
});

describe("getSoftAgreementAckError", () => {
  const hash = "sha256:deadbeef";

  it("requires ack", () => {
    expect(getSoftAgreementAckError(null, hash)).toMatch(/required/i);
  });

  it("rejects tool/MCP source (비위임)", () => {
    expect(
      getSoftAgreementAckError(
        {
          version: SOFT_AGREEMENT_ACK_VERSION,
          source: "mcp_tool",
          terms_hash: hash,
          attested_at: new Date().toISOString(),
        },
        hash,
      ),
    ).toMatch(/buyer_ui_cta/);
  });

  it("accepts buyer_ui_cta with matching hash", () => {
    expect(
      getSoftAgreementAckError(
        {
          version: SOFT_AGREEMENT_ACK_VERSION,
          source: SOFT_AGREEMENT_ACK_SOURCE_BUYER_UI_CTA,
          terms_hash: hash,
          attested_at: new Date().toISOString(),
        },
        hash,
      ),
    ).toBeNull();
  });

  it("rejects hash mismatch", () => {
    expect(
      getSoftAgreementAckError(
        {
          version: SOFT_AGREEMENT_ACK_VERSION,
          source: SOFT_AGREEMENT_ACK_SOURCE_BUYER_UI_CTA,
          terms_hash: "sha256:other",
          attested_at: new Date().toISOString(),
        },
        hash,
      ),
    ).toMatch(/does not match/);
  });
});
