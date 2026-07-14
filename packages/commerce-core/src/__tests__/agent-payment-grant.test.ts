import { describe, expect, it } from "vitest";
import {
  type AgentPaymentGrant,
  canonicalizeAgentPaymentPolicy,
  findPaymentLegalTermIssues,
} from "../agent-payment-grant.js";

function makeGrant(overrides: Partial<AgentPaymentGrant> = {}): AgentPaymentGrant {
  return {
    grant_id: "grant_1",
    buyer_id: "buyer_1",
    agent_id: "agent_1",
    listing_id: "listing_1",
    seller_id: "seller_1",
    order_id: "order_1",
    settlement_approval_id: "approval_1",
    max_amount_minor: 90_000,
    currency: "USD",
    asset: "USDC",
    network: "base",
    allowed_rails: ["x402", "stripe"],
    preferred_rail: "x402",
    terms: [
      {
        key: "battery_min_percent",
        label: "Minimum battery health",
        type: "percent",
        value: 90,
        required: true,
      },
      {
        key: "max_price",
        label: "Maximum approved price",
        type: "money",
        value_minor: 90_000,
        currency: "USD",
        required: true,
      },
    ],
    expires_at: "2026-05-12T00:00:00.000Z",
    nonce: "nonce_1",
    human_confirmation_required: false,
    legal_acknowledgements: {
      no_custody: true,
      buyer_approved_rules: true,
      stripe_fallback: true,
      stablecoin_not_investment: true,
    },
    ...overrides,
  };
}

describe("agent payment grants", () => {
  it("canonicalizes the same policy deterministically", () => {
    const first = canonicalizeAgentPaymentPolicy(makeGrant());
    const second = canonicalizeAgentPaymentPolicy(makeGrant());

    expect(first).toBe(second);
    expect(first).toContain("haggle.agent_payment_binding.v1");
    expect(first).toContain("battery_min_percent");
  });

  it("does not include random grant identifiers in the policy hash input", () => {
    const first = canonicalizeAgentPaymentPolicy(
      makeGrant({ grant_id: "grant_1", nonce: "nonce_1" }),
    );
    const second = canonicalizeAgentPaymentPolicy(
      makeGrant({ grant_id: "grant_2", nonce: "nonce_2" }),
    );

    expect(second).toBe(first);
    expect(first).not.toContain("grant_1");
    expect(first).not.toContain("nonce_1");
  });

  it("changes canonical policy when a payment condition changes", () => {
    const base = canonicalizeAgentPaymentPolicy(makeGrant());
    const changed = canonicalizeAgentPaymentPolicy(makeGrant({ max_amount_minor: 95_000 }));

    expect(changed).not.toBe(base);
  });

  it("flags legally sensitive payment terms", () => {
    const issues = findPaymentLegalTermIssues(
      "We provide escrow custody with guaranteed safe settlement.",
    );

    expect(issues.map((issue) => issue.term)).toEqual(
      expect.arrayContaining(["escrow", "custody", "guaranteed safe"]),
    );
  });
});
