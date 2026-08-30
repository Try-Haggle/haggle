import { describe, expect, it } from "vitest";
import {
  calculateFeeMinor,
  calculateStripeOnrampFeeMinor,
  STRIPE_ONRAMP_FIXED_FEE_MINOR,
} from "../payments/fee-policy.js";

describe("card onramp fee", () => {
  it("is 1.5% of the agreed total with no $0.30", () => {
    expect(STRIPE_ONRAMP_FIXED_FEE_MINOR).toBe(0);
    expect(calculateStripeOnrampFeeMinor(70_000, 150)).toBe(1_050);
    expect(calculateStripeOnrampFeeMinor(70_000, 150)).toBe(calculateFeeMinor(70_000, 150));
  });
});
