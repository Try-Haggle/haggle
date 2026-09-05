import { describe, expect, it } from "vitest";
import { classifyStripeKeyMode, getStripeConfig } from "../stripe-onramp.js";

describe("classifyStripeKeyMode", () => {
  it("detects test keys", () => {
    expect(classifyStripeKeyMode("sk_test_abc", "pk_test_abc")).toBe("test");
  });

  it("detects live keys", () => {
    expect(classifyStripeKeyMode("sk_live_abc", "pk_live_abc")).toBe("live");
  });

  it("returns missing when both empty", () => {
    expect(classifyStripeKeyMode("", "")).toBe("missing");
  });

  it("returns unknown on mixed test/live", () => {
    expect(classifyStripeKeyMode("sk_test_abc", "pk_live_abc")).toBe("unknown");
  });
});

describe("getStripeConfig keyMode", () => {
  it("exposes stripeMode and keyMode without leaking secrets in keyMode", () => {
    const previousSecret = process.env.STRIPE_SECRET_KEY;
    const previousPublishable = process.env.STRIPE_PUBLISHABLE_KEY;
    const previousMode = process.env.STRIPE_MODE;
    process.env.STRIPE_SECRET_KEY = "sk_test_dogfood";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_dogfood";
    process.env.STRIPE_MODE = "real";
    try {
      const config = getStripeConfig();
      expect(config.enabled).toBe(true);
      expect(config.stripeMode).toBe("real");
      expect(config.keyMode).toBe("test");
    } finally {
      if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousSecret;
      if (previousPublishable === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
      else process.env.STRIPE_PUBLISHABLE_KEY = previousPublishable;
      if (previousMode === undefined) delete process.env.STRIPE_MODE;
      else process.env.STRIPE_MODE = previousMode;
    }
  });
});
