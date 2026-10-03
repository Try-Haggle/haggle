import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRealStripeAdapterOrNull } from "../providers.js";
import { RealStripeAdapter } from "../real-stripe-adapter.js";

describe("Stripe provider factory in the ESM API runtime", () => {
  beforeEach(() => {
    vi.stubGlobal("require", undefined);
    vi.stubEnv("STRIPE_MODE", "real");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_factory_regression");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_factory_regression");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("constructs the provider in a native ESM process outside Vitest's module wrapper", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        'import { getRealStripeAdapterOrNull } from "./src/payments/providers.ts"; console.log(JSON.stringify({ rail: getRealStripeAdapterOrNull()?.rail }));',
      ],
      { cwd: fileURLToPath(new URL("../../../", import.meta.url)), timeout: 30_000 },
    );
    expect(JSON.parse(output.toString())).toEqual({ rail: "stripe" });
  }, 40_000);

  it("loads the actual SDK without global require and verifies a signed webhook", () => {
    const adapter = getRealStripeAdapterOrNull();
    expect(adapter).toBeInstanceOf(RealStripeAdapter);
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      id: "evt_factory_regression",
      object: "event",
      type: "crypto.onramp_session.fulfillment_complete",
      livemode: false,
      data: { object: { id: "cos_factory_regression" } },
    });
    const signature = createHmac("sha256", "whsec_factory_regression")
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    expect(adapter?.constructWebhookEvent(payload, `t=${timestamp},v1=${signature}`).id).toBe(
      "evt_factory_regression",
    );
    expect(() =>
      adapter?.constructWebhookEvent(payload, `t=${timestamp},v1=${"0".repeat(64)}`),
    ).toThrow();
  });

  it("keeps mock mode independent of Stripe credentials", () => {
    vi.stubEnv("STRIPE_MODE", "mock");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(getRealStripeAdapterOrNull()).toBeNull();
  });

  it.each([
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ])("rejects real mode when %s is missing", (key) => {
    vi.stubEnv(key, "");
    expect(() => getRealStripeAdapterOrNull()).toThrow(`STRIPE_MODE=real requires ${key}`);
  });
});
