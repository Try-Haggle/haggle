import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recheckPaymentProviderStatus,
  setPaymentWebhookProviderRecheckForTests,
} from "../services/payment-webhook-provider-recheck.service.js";

describe("payment-webhook-provider-recheck.service (B6)", () => {
  afterEach(() => {
    setPaymentWebhookProviderRecheckForTests(null);
    vi.unstubAllEnvs();
  });

  it("prefers provider_status from stored provider context", async () => {
    const result = await recheckPaymentProviderStatus({
      provider: "x402",
      paymentIntentId: "pi_123",
      eventType: "settlement.failed",
      providerContext: { provider_status: "captured" },
    });
    expect(result).toEqual({
      outcome: "confirmed",
      providerState: "captured",
      source: "provider_context",
    });
  });

  it("implies confirming mock state from the webhook event when not live", async () => {
    const result = await recheckPaymentProviderStatus({
      provider: "x402",
      paymentIntentId: "pi_123",
      eventType: "settlement.confirmed",
      providerContext: {},
    });
    expect(result).toEqual({
      outcome: "confirmed",
      providerState: "captured",
      source: "mock_event_implied",
    });
  });

  it("returns unavailable in live production without stored provider status", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HAGGLE_ENV", "production");
    const result = await recheckPaymentProviderStatus({
      provider: "x402",
      paymentIntentId: "pi_123",
      eventType: "settlement.failed",
      providerContext: {},
    });
    expect(result).toEqual({
      outcome: "unavailable",
      reason: "provider_live_recheck_unavailable",
    });
  });

  it("honors test override injection", async () => {
    setPaymentWebhookProviderRecheckForTests(async () => ({
      outcome: "inconclusive",
      reason: "forced",
    }));
    await expect(
      recheckPaymentProviderStatus({
        provider: "stripe",
        paymentIntentId: "pi_1",
        eventType: "settlement.confirmed",
      }),
    ).resolves.toEqual({ outcome: "inconclusive", reason: "forced" });
  });
});
