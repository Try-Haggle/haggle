import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPaymentMetricEvent,
  emitPaymentMetric,
  emitPaymentMetricSafely,
  normalizePaymentMetricEventType,
  normalizePaymentMetricFailureType,
  setPaymentMetricSink,
  toPaymentMetricOperation,
  type PaymentMetricEvent,
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
    expect(() => createPaymentMetricEvent("payment.webhook.rejected", {
      provider: "stripe",
      event_type: "crypto.onramp_session.fulfillment_complete",
      environment: "live",
    })).toThrow('Unsafe payment metric dimension "event_type"');
  });

  it("rejects sensitive or high-cardinality metric values", () => {
    expect(() => createPaymentMetricEvent("payment.webhook.received", {
      provider: "stripe",
      event_type: "evt_123456789abcdef",
      environment: "live",
    })).toThrow("Unsafe payment metric value");

    expect(() => createPaymentMetricEvent("payment.webhook.received", {
      provider: "stripe",
      event_type: "buyer@example.com",
      environment: "live",
    })).toThrow("Unsafe payment metric value");

    expect(() => createPaymentMetricEvent("payment.webhook.received", {
      provider: "stripe",
      event_type: "4242424242424242",
      environment: "live",
    })).toThrow("Unsafe payment metric value");
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
    expect(normalizePaymentMetricFailureType("signature_verification_failed")).toBe("signature_invalid");
    expect(normalizePaymentMetricFailureType("webhook_secret_not_configured")).toBe("config_missing");
    expect(normalizePaymentMetricEventType("crypto.onramp_session.fulfillment_complete")).toBe("crypto.onramp_session.fulfillment_complete");
    expect(normalizePaymentMetricEventType("evt_123456789abcdef")).toBe("unknown");
  });
});
