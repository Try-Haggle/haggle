import { describe, expect, it } from "vitest";
import {
  type CheckoutAgreementDisplay,
  isFullAgreementRenderable,
} from "./checkout-full-agreement";

function base(): CheckoutAgreementDisplay {
  return {
    price_minor: 50_000,
    currency: "USD",
    fulfillment_type: "physical_shipping",
    fulfillment_summary: "Carrier shipping",
    address: {
      kind: "delivery",
      lines: ["Ada Lovelace", "123 Main St", "Denver, CO 80202"],
    },
    shipping_cost_minor: 0,
    fees: {
      haggle_fee_bps: 150,
      card_buyer_total_bps: 300,
      item_minor: 50_000,
      shipping_minor: 0,
      haggle_fee_minor: 750,
      card_fee_minor: 1500,
      buyer_pays_wallet_minor: 50_750,
      buyer_pays_card_minor: 51_500,
    },
    criteria: [
      { check_id: "imei_clean", label: "IMEI", seller_value: "Clean", buyer_stance: "Required" },
    ],
    terms_hash: "sha256:abc",
  };
}

describe("isFullAgreementRenderable", () => {
  it("accepts a complete Soft agreement snapshot", () => {
    expect(isFullAgreementRenderable(base())).toBe(true);
  });

  it("allows empty criteria list (still a rendered block)", () => {
    expect(isFullAgreementRenderable({ ...base(), criteria: [] })).toBe(true);
  });

  it("rejects missing delivery address", () => {
    expect(
      isFullAgreementRenderable({
        ...base(),
        address: { kind: "delivery", lines: ["Address missing from Soft agreement"] },
      }),
    ).toBe(false);
  });

  it("rejects zero price", () => {
    expect(isFullAgreementRenderable({ ...base(), price_minor: 0 })).toBe(false);
  });

  it("rejects null", () => {
    expect(isFullAgreementRenderable(null)).toBe(false);
  });
});
