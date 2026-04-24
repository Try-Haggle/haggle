import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealStripeAdapter, type RealStripeAdapterConfig } from "../real-stripe-adapter.js";
import type { PaymentIntent, Refund } from "@haggle/payment-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntent(overrides?: Partial<PaymentIntent>): PaymentIntent {
  return {
    id: "pi_test_123",
    order_id: "order_456",
    seller_id: "seller_789",
    buyer_id: "buyer_abc",
    selected_rail: "stripe",
    allowed_rails: ["stripe"],
    amount: { currency: "USD", amount_minor: 58500 },
    status: "AUTHORIZED",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRefund(overrides?: Partial<Refund>): Refund {
  return {
    id: "refund_001",
    payment_intent_id: "pi_test_123",
    amount: { currency: "USD", amount_minor: 10000 },
    reason_code: "buyer_request",
    status: "REQUESTED",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createMockStripe() {
  return {
    rawRequest: vi.fn(),
    webhooks: {
      constructEvent: vi.fn(),
    },
  };
}

function createAdapter(mockStripe?: ReturnType<typeof createMockStripe>) {
  const stripe = mockStripe ?? createMockStripe();
  const config: RealStripeAdapterConfig = {
    stripe: stripe as any,
    webhookSecret: "whsec_test_secret",
    defaultDestinationWallet: "0x1234567890abcdef1234567890abcdef12345678",
    destinationNetwork: "base",
  };
  return { adapter: new RealStripeAdapter(config), stripe };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RealStripeAdapter", () => {
  describe("constructor and properties", () => {
    it("has correct rail and provider", () => {
      const { adapter } = createAdapter();
      expect(adapter.rail).toBe("stripe");
      expect(adapter.provider).toBe("ai.haggle.stripe.onramp");
    });
  });

  describe("quote()", () => {
    it("returns quote with fee info and no API call", async () => {
      const { adapter, stripe } = createAdapter();
      const intent = makeIntent();

      const quote = await adapter.quote(intent);

      expect(quote.rail).toBe("stripe");
      expect(quote.amount).toEqual(intent.amount);
      expect(quote.expires_at).toBeDefined();
      expect(quote.metadata).toMatchObject({
        mode: "crypto_onramp",
        stripe_fee_pct: 1.5,
        destination_network: "base",
        destination_currency: "usdc",
      });
      // No Stripe API call for quote
      expect(stripe.rawRequest).not.toHaveBeenCalled();
    });
  });

  describe("authorize()", () => {
    it("creates onramp session via Stripe rawRequest", async () => {
      const mockStripe = createMockStripe();
      mockStripe.rawRequest.mockResolvedValue({
        content: JSON.stringify({
          id: "cos_test_session_id",
          client_secret: "cos_secret_abc",
          status: "initialized",
          redirect_url: "https://checkout.stripe.com/onramp/xyz",
        }),
      });

      const { adapter } = createAdapter(mockStripe);
      const intent = makeIntent();

      const result = await adapter.authorize(intent);

      // Verify Stripe was called correctly
      expect(mockStripe.rawRequest).toHaveBeenCalledWith(
        "POST",
        "/v1/crypto/onramp_sessions",
        expect.objectContaining({
          destination_currency: "usdc",
          destination_network: "base",
          destination_amount: "585.00",
          metadata: expect.objectContaining({
            payment_intent_id: "pi_test_123",
            order_id: "order_456",
            platform: "haggle",
          }),
        }),
      );

      // Verify result structure
      expect(result.authorization.payment_intent_id).toBe("pi_test_123");
      expect(result.authorization.rail).toBe("stripe");
      expect(result.authorization.provider_reference).toBe("cos_test_session_id");
      expect(result.metadata).toMatchObject({
        onramp_session_id: "cos_test_session_id",
        client_secret: "cos_secret_abc",
        hosted_url: "https://checkout.stripe.com/onramp/xyz",
        status: "initialized",
      });
    });

    it("propagates Stripe API errors", async () => {
      const mockStripe = createMockStripe();
      mockStripe.rawRequest.mockRejectedValue(new Error("Stripe error: invalid API key"));

      const { adapter } = createAdapter(mockStripe);
      const intent = makeIntent();

      await expect(adapter.authorize(intent)).rejects.toThrow("Stripe error: invalid API key");
    });

    it("converts amount_minor to USD string correctly", async () => {
      const mockStripe = createMockStripe();
      mockStripe.rawRequest.mockResolvedValue({
        content: JSON.stringify({ id: "cos_1", client_secret: "s", status: "initialized" }),
      });

      const { adapter } = createAdapter(mockStripe);

      // $12.34
      await adapter.authorize(makeIntent({ amount: { currency: "USD", amount_minor: 1234 } }));
      expect(mockStripe.rawRequest).toHaveBeenCalledWith(
        "POST",
        "/v1/crypto/onramp_sessions",
        expect.objectContaining({ destination_amount: "12.34" }),
      );

      // $0.01
      mockStripe.rawRequest.mockClear();
      mockStripe.rawRequest.mockResolvedValue({
        content: JSON.stringify({ id: "cos_2", client_secret: "s", status: "initialized" }),
      });
      await adapter.authorize(makeIntent({ amount: { currency: "USD", amount_minor: 1 } }));
      expect(mockStripe.rawRequest).toHaveBeenCalledWith(
        "POST",
        "/v1/crypto/onramp_sessions",
        expect.objectContaining({ destination_amount: "0.01" }),
      );
    });
  });

  describe("settle()", () => {
    it("records settlement without API call", async () => {
      const { adapter, stripe } = createAdapter();
      const intent = makeIntent({ status: "SETTLEMENT_PENDING" });

      const result = await adapter.settle(intent);

      expect(result.settlement.payment_intent_id).toBe("pi_test_123");
      expect(result.settlement.rail).toBe("stripe");
      expect(result.settlement.status).toBe("SETTLED");
      expect(result.settlement.settled_amount).toEqual(intent.amount);
      expect(result.metadata).toMatchObject({
        settlement_method: "crypto_onramp",
        destination_network: "base",
        destination_currency: "usdc",
      });
      // No API call — settlement is triggered by webhook
      expect(stripe.rawRequest).not.toHaveBeenCalled();
    });
  });

  describe("refund()", () => {
    it("returns PENDING refund with manual processing note", async () => {
      const { adapter } = createAdapter();
      const intent = makeIntent({ status: "SETTLED" });
      const refund = makeRefund();

      const result = await adapter.refund(intent, refund);

      expect(result.refund.status).toBe("PENDING");
      expect(result.refund.id).toBe("refund_001");
      expect(result.metadata).toMatchObject({
        refund_method: "manual_crypto_onramp",
        original_payment_intent_id: "pi_test_123",
      });
      expect(result.metadata?.note).toContain("manual processing");
    });
  });

  describe("constructWebhookEvent()", () => {
    it("delegates to stripe.webhooks.constructEvent", () => {
      const mockStripe = createMockStripe();
      const fakeEvent = { id: "evt_123", type: "crypto.onramp_session.fulfillment_complete" };
      mockStripe.webhooks.constructEvent.mockReturnValue(fakeEvent);

      const { adapter } = createAdapter(mockStripe);
      const result = adapter.constructWebhookEvent('{"data":{}}', "t=123,v1=abc");

      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        '{"data":{}}',
        "t=123,v1=abc",
        "whsec_test_secret",
      );
      expect(result).toBe(fakeEvent);
    });

    it("throws on invalid signature", () => {
      const mockStripe = createMockStripe();
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error("Signature verification failed");
      });

      const { adapter } = createAdapter(mockStripe);

      expect(() => adapter.constructWebhookEvent("{}", "bad_sig")).toThrow(
        "Signature verification failed",
      );
    });
  });

  describe("static helpers", () => {
    it("isOnrampFulfillmentComplete detects correct event type", () => {
      expect(
        RealStripeAdapter.isOnrampFulfillmentComplete({
          type: "crypto.onramp_session.fulfillment_complete",
        } as any),
      ).toBe(true);

      expect(
        RealStripeAdapter.isOnrampFulfillmentComplete({
          type: "payment_intent.succeeded",
        } as any),
      ).toBe(false);
    });

    it("extractPaymentIntentId gets payment_intent_id from metadata", () => {
      expect(
        RealStripeAdapter.extractPaymentIntentId({
          data: {
            object: {
              metadata: { payment_intent_id: "pi_test_xyz" },
            },
          },
        } as any),
      ).toBe("pi_test_xyz");
    });

    it("extractPaymentIntentId returns null when metadata missing", () => {
      expect(
        RealStripeAdapter.extractPaymentIntentId({
          data: { object: {} },
        } as any),
      ).toBeNull();

      expect(
        RealStripeAdapter.extractPaymentIntentId({
          data: { object: { metadata: {} } },
        } as any),
      ).toBeNull();
    });
  });
});

describe("RealStripeAdapter — graceful fallback", () => {
  it("createAdapter throws clear error when stripe API key is missing (simulated)", async () => {
    // The adapter itself doesn't validate config — that's done in providers.ts.
    // But if Stripe SDK is instantiated with no key, the first API call fails.
    const mockStripe = createMockStripe();
    mockStripe.rawRequest.mockRejectedValue(
      new Error("Invalid API Key provided: undefined"),
    );

    const config: RealStripeAdapterConfig = {
      stripe: mockStripe as any,
      webhookSecret: "whsec_test",
      defaultDestinationWallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const adapter = new RealStripeAdapter(config);

    await expect(adapter.authorize(makeIntent())).rejects.toThrow("Invalid API Key");
  });
});
