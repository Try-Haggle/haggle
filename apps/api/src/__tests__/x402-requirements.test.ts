import { describe, expect, it } from "vitest";
import { createX402PaymentRequirement } from "../payments/x402-requirements.js";
import type { PaymentIntent } from "@haggle/payment-core";

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: "payment_1",
    order_id: "order_1",
    seller_id: "seller_1",
    buyer_id: "buyer_1",
    selected_rail: "x402",
    allowed_rails: ["x402", "stripe"],
    buyer_authorization_mode: "agent_wallet",
    amount: {
      currency: "USD",
      amount_minor: 90_000,
    },
    status: "QUOTED",
    agent_payment_grant_id: "grant_1",
    approval_policy_hash: "sha256:policy",
    agreement_hash: "sha256:agreement",
    listing_hash: "sha256:listing",
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("createX402PaymentRequirement", () => {
  it("binds x402 requirements to the agent payment policy", () => {
    const envelope = createX402PaymentRequirement(makeIntent(), {
      resource: "https://api.haggle.test/payments/payment_1/x402/submit-signature",
      sellerWallet: "0x1111111111111111111111111111111111111111",
      paymentReceiver: "0x2222222222222222222222222222222222222222",
      receiverRole: "payment_receiver",
      network: "eip155:8453",
      assetAddress: "0x3333333333333333333333333333333333333333",
    });

    expect(envelope.accepts).toHaveLength(1);
    expect(envelope.accepts[0]?.payTo).toBe("0x2222222222222222222222222222222222222222");
    expect(envelope.accepts[0]?.maxAmountRequired).toBe("900000000");
    expect(envelope.accepts[0]?.extra).toMatchObject({
      payment_intent_id: "payment_1",
      order_id: "order_1",
      grant_id: "grant_1",
      approval_policy_hash: "sha256:policy",
      agreement_hash: "sha256:agreement",
      listing_hash: "sha256:listing",
      settlement_asset: "USDC",
      settlement_amount_minor: "900000000",
      settlement_amount_decimals: 6,
      seller_wallet: "0x1111111111111111111111111111111111111111",
      pay_to_role: "payment_receiver",
    });
  });

  it("falls back to seller wallet only when no settlement receiver is configured", () => {
    const envelope = createX402PaymentRequirement(makeIntent(), {
      resource: "https://api.haggle.test/payments/payment_1/x402/submit-signature",
      sellerWallet: "0x1111111111111111111111111111111111111111",
      network: "eip155:8453",
      assetAddress: "USDC",
    });

    expect(envelope.accepts[0]?.payTo).toBe("0x1111111111111111111111111111111111111111");
    expect(envelope.accepts[0]?.extra?.pay_to_role).toBe("seller_wallet");
  });

  it("rejects unsupported source currencies instead of treating them as USD cents", () => {
    expect(() => createX402PaymentRequirement(makeIntent({
      amount: {
        currency: "EUR",
        amount_minor: 90_000,
      },
    }), {
      resource: "https://api.haggle.test/payments/payment_1/x402/submit-signature",
      sellerWallet: "0x1111111111111111111111111111111111111111",
      network: "eip155:8453",
      assetAddress: "USDC",
    })).toThrow("unsupported source currency for USDC settlement: EUR");
  });
});
