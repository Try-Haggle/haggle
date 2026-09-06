import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertStagingStripeOnrampKeysAllowed,
  classifyStripeKeyMode,
  createOnrampSession,
  getStripeConfig,
  isStagingLiveStripeKeysForbidden,
  STAGING_LIVE_STRIPE_KEYS_FORBIDDEN,
} from "../stripe-onramp.js";

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

describe("staging live Stripe key hard gate", () => {
  const previousHaggleEnv = process.env.HAGGLE_ENV;
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousPublishable = process.env.STRIPE_PUBLISHABLE_KEY;

  afterEach(() => {
    if (previousHaggleEnv === undefined) delete process.env.HAGGLE_ENV;
    else process.env.HAGGLE_ENV = previousHaggleEnv;
    if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousPublishable === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = previousPublishable;
    vi.unstubAllGlobals();
  });

  it("forbids live keys when HAGGLE_ENV=staging", () => {
    expect(isStagingLiveStripeKeysForbidden({ HAGGLE_ENV: "staging" }, "live")).toBe(true);
    expect(() =>
      assertStagingStripeOnrampKeysAllowed({ HAGGLE_ENV: "staging" }, "live"),
    ).toThrowError(/STAGING_LIVE_STRIPE_KEYS_FORBIDDEN/);
    try {
      assertStagingStripeOnrampKeysAllowed({ HAGGLE_ENV: "staging" }, "live");
      expect.unreachable("expected assertStagingStripeOnrampKeysAllowed to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: STAGING_LIVE_STRIPE_KEYS_FORBIDDEN,
        statusCode: 503,
      });
    }
  });

  it("allows test keys on staging", () => {
    expect(isStagingLiveStripeKeysForbidden({ HAGGLE_ENV: "staging" }, "test")).toBe(false);
    expect(() =>
      assertStagingStripeOnrampKeysAllowed({ HAGGLE_ENV: "staging" }, "test"),
    ).not.toThrow();
  });

  it("allows live keys outside staging (production)", () => {
    expect(isStagingLiveStripeKeysForbidden({ HAGGLE_ENV: "production" }, "live")).toBe(false);
    expect(() =>
      assertStagingStripeOnrampKeysAllowed({ HAGGLE_ENV: "production" }, "live"),
    ).not.toThrow();
  });

  it("createOnrampSession fail-closes before calling Stripe when staging has live keys", async () => {
    process.env.HAGGLE_ENV = "staging";
    process.env.STRIPE_SECRET_KEY = "sk_live_forbidden";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_forbidden";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      createOnrampSession({
        destinationWallet: "0x1111111111111111111111111111111111111111",
        amountMinor: 1000,
        paymentIntentId: "pi_gate",
      }),
    ).rejects.toMatchObject({ code: STAGING_LIVE_STRIPE_KEYS_FORBIDDEN });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
