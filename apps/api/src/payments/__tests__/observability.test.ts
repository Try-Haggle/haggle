import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPaymentMetricEvent,
  emitPaymentMetric,
  emitPaymentMetricSafely,
  normalizePaymentMetricEventType,
  normalizePaymentMetricFailureType,
  type PaymentMetricDimensions,
  type PaymentMetricEvent,
  setPaymentMetricSink,
  toPaymentMetricOperation,
} from "../observability.js";

let restoreSink: (() => void) | null = null;

afterEach(() => {
  restoreSink?.();
  restoreSink = null;
  vi.restoreAllMocks();
});

describe("payment observability", () => {
  it("emits allowlisted backend-neutral metric events", async () => {
    const events: PaymentMetricEvent[] = [];
    restoreSink = setPaymentMetricSink((event) => {
      events.push(event);
    });

    await emitPaymentMetric("payment.idempotency.result", {
      operation: "capture",
      idempotency_result: "duplicate",
      environment: "live",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "payment.idempotency.result",
      value: 1,
      dimensions: {
        operation: "capture",
        idempotency_result: "duplicate",
        environment: "live",
      },
    });
    expect(events[0]?.timestamp).toEqual(expect.any(String));
  });

  it("rejects dimensions that do not belong to a metric", () => {
    expect(() =>
      createPaymentMetricEvent("payment.webhook.rejected", {
        provider: "stripe",
        event_type: "crypto.onramp_session.fulfillment_complete",
        environment: "live",
      }),
    ).toThrow('Unsafe payment metric dimension "event_type"');
  });

  it("rejects PII or secret-looking dimension keys even when cast in", () => {
    const unsafeKeys = [
      "client_secret",
      "pan",
      "card_number",
      "cvv",
      "email",
      "user_id",
      "order_id",
      "payment_intent_id",
      "wallet_address",
      "authorization",
      "signature",
    ] as const;

    for (const key of unsafeKeys) {
      expect(() =>
        createPaymentMetricEvent("payment.webhook.received", {
          provider: "stripe",
          event_type: "crypto.onramp_session.fulfillment_complete",
          environment: "live",
          [key]: "placeholder",
        } as PaymentMetricDimensions),
      ).toThrow(`Unsafe payment metric dimension "${key}"`);
    }
  });

  it("rejects sensitive or high-cardinality metric values", () => {
    expect(() =>
      createPaymentMetricEvent("payment.webhook.received", {
        provider: "stripe",
        event_type: "evt_123456789abcdef",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.webhook.received", {
        provider: "stripe",
        event_type: "buyer@example.com",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.webhook.received", {
        provider: "stripe",
        event_type: "4242424242424242",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.webhook.received", {
        provider: "stripe",
        event_type: "550e8400-e29b-41d4-a716-446655440000",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.webhook.received", {
        provider: "stripe",
        event_type: "user_00aabbccddee",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.webhook.received", {
        provider: "stripe",
        event_type: "sk_live_51AbCdEfGhIjKlMn",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.webhook.received", {
        provider: "stripe",
        event_type: "whsec_abc123def456ghi789",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.webhook.received", {
        provider: "stripe",
        event_type: "Bearer eyJhbGciOiJIUzI1NiJ9",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.webhook.received", {
        provider: "stripe",
        event_type: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.webhook.received", {
        provider: "stripe",
        event_type: "x".repeat(81),
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");
  });

  it("rejects non-allowlisted enum and reconciliation label values", () => {
    expect(() =>
      createPaymentMetricEvent("payment.webhook.received", {
        provider: "evil_provider" as "stripe",
        event_type: "crypto.onramp_session.fulfillment_complete",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.idempotency.result", {
        operation: "capture",
        idempotency_result: "replayed" as "duplicate",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.reconciliation.finding", {
        provider: "stripe",
        reconciliation_type: "order_paid_like_intent_not_settled_for_abc123",
        environment: "live",
      }),
    ).toThrow("Unsafe payment metric value");

    expect(() =>
      createPaymentMetricEvent("payment.reconciliation.finding", {
        provider: "stripe",
        reconciliation_type: "amount_mismatch",
        environment: "live",
      }),
    ).not.toThrow();
  });

  it("drops unsafe metric events without logging the unsafe value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await emitPaymentMetricSafely("payment.webhook.received", {
      provider: "stripe",
      event_type: "pm_secret_token_123456",
      environment: "live",
    });

    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("pm_secret_token_123456");
  });

  it("normalizes route operation and failure strings to safe metric labels", () => {
    expect(toPaymentMetricOperation("payment.stripe_onramp_session")).toBe("prepare");
    expect(toPaymentMetricOperation("payment.x402_settle")).toBe("capture");
    expect(toPaymentMetricOperation("unknown_operation")).toBeNull();
    expect(normalizePaymentMetricFailureType("signature_verification_failed")).toBe(
      "signature_invalid",
    );
    expect(normalizePaymentMetricFailureType("webhook_secret_not_configured")).toBe(
      "config_missing",
    );
    expect(normalizePaymentMetricEventType("crypto.onramp_session.fulfillment_complete")).toBe(
      "crypto.onramp_session.fulfillment_complete",
    );
    expect(normalizePaymentMetricEventType("evt_123456789abcdef")).toBe("unknown");
    expect(normalizePaymentMetricEventType("550e8400-e29b-41d4-a716-446655440000")).toBe("unknown");
    expect(normalizePaymentMetricEventType("sk_live_51AbCdEfGhIjKlMn")).toBe("unknown");
  });
});
