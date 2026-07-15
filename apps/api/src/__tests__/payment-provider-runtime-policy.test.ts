import { describe, expect, it } from "vitest";
import { requiresRealPaymentProviders } from "../payments/provider-runtime-policy.js";

describe("payment provider runtime policy", () => {
  it("requires real providers in production by default", () => {
    expect(requiresRealPaymentProviders({ NODE_ENV: "production" })).toBe(true);
  });

  it("allows mock providers only for an explicitly enabled staging environment", () => {
    expect(
      requiresRealPaymentProviders({
        NODE_ENV: "production",
        HAGGLE_ENV: "staging",
        HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS: "true",
      }),
    ).toBe(false);
  });

  it("does not allow the staging opt-in in production", () => {
    expect(
      requiresRealPaymentProviders({
        NODE_ENV: "production",
        HAGGLE_ENV: "production",
        HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS: "true",
      }),
    ).toBe(true);
  });
});
