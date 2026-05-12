import { describe, expect, it } from "vitest";
import {
  assertProductionPaymentTransition,
  calculateRetryDelayMs,
  classifyProviderError,
  createPaymentAuditEvent,
  detectPaymentReconciliationFindings,
  mapLegacyStatusToProductionState,
  redactPaymentSensitiveData,
  transitionProductionPaymentState,
} from "../production-readiness.js";

describe("production payment state machine", () => {
  it("allows only production-safe payment transitions", () => {
    expect(transitionProductionPaymentState("pending", "authorize")).toBe("authorized");
    expect(transitionProductionPaymentState("authorized", "capture")).toBe("captured");
    expect(transitionProductionPaymentState("captured", "partial_refund")).toBe("partially_refunded");
    expect(transitionProductionPaymentState("partially_refunded", "refund")).toBe("refunded");
  });

  it("rejects impossible or unsafe transitions", () => {
    expect(transitionProductionPaymentState("canceled", "capture")).toBeNull();
    expect(transitionProductionPaymentState("pending", "refund")).toBeNull();
    expect(transitionProductionPaymentState("captured", "capture")).toBeNull();
    expect(() => assertProductionPaymentTransition("canceled", "capture")).toThrow(
      "invalid production payment transition: canceled -> capture",
    );
  });

  it("maps legacy persisted states without changing the database enum", () => {
    expect(mapLegacyStatusToProductionState("CREATED")).toBe("pending");
    expect(mapLegacyStatusToProductionState("QUOTED")).toBe("pending");
    expect(mapLegacyStatusToProductionState("AUTHORIZED")).toBe("authorized");
    expect(mapLegacyStatusToProductionState("SETTLEMENT_PENDING")).toBe("authorized");
    expect(mapLegacyStatusToProductionState("SETTLED")).toBe("captured");
    expect(mapLegacyStatusToProductionState("FAILED")).toBe("failed");
    expect(mapLegacyStatusToProductionState("CANCELED")).toBe("canceled");
  });
});

describe("payment sensitive data redaction", () => {
  it("redacts payment secrets recursively while preserving non-sensitive fields", () => {
    expect(redactPaymentSensitiveData({
      order_id: "ord_1",
      client_secret: "pi_secret_123",
      authorization: "Bearer sk_test_123",
      nested: {
        payment_method_id: "pm_123",
        card: {
          card_number: "4242424242424242",
          exp_month: "12",
          exp_year: "2030",
          brand: "visa",
        },
      },
      events: [{ wallet_token: "tok_wallet", status: "pending" }],
      shipping: {
        account_number: "123456789",
        routing_number: "021000021",
        iban: "GB82WEST12345698765432",
      },
    })).toEqual({
      order_id: "ord_1",
      client_secret: "[REDACTED]",
      authorization: "[REDACTED]",
      nested: {
        payment_method_id: "[REDACTED]",
        card: {
          card_number: "[REDACTED]",
          exp_month: "[REDACTED]",
          exp_year: "[REDACTED]",
          brand: "visa",
        },
      },
      events: [{ wallet_token: "[REDACTED]", status: "pending" }],
      shipping: {
        account_number: "[REDACTED]",
        routing_number: "[REDACTED]",
        iban: "[REDACTED]",
      },
    });
  });

  it("redacts PAN values even when the field name is not sensitive", () => {
    expect(redactPaymentSensitiveData({
      note: "customer typed 4242 4242 4242 4242 in the support field",
      primary_account_number: "5555555555554444",
      pan: "4000000000000002",
      span_id: "trace-span-1",
      unrelated_number: "1234567890123",
    })).toEqual({
      note: "customer typed [REDACTED_PAN] in the support field",
      primary_account_number: "[REDACTED]",
      pan: "[REDACTED]",
      span_id: "trace-span-1",
      unrelated_number: "1234567890123",
    });
  });

  it("redacts audit metadata before returning an event object", () => {
    const event = createPaymentAuditEvent({
      type: "webhook_rejected",
      actor: { id: "system", role: "system" },
      payment_intent_id: "pi_1",
      reason: "invalid signature",
      request_id: "req_1",
      timestamp: "2026-05-11T00:00:00.000Z",
      metadata: {
        stripe_signature: "t=1,v1=secret",
        provider_event_id: "evt_1",
      },
    });

    expect(event.metadata).toEqual({
      stripe_signature: "[REDACTED]",
      provider_event_id: "evt_1",
    });
  });

  it("handles circular objects and Error instances without leaking messages", () => {
    const circular: Record<string, unknown> = { client_secret: "secret" };
    circular.self = circular;

    expect(redactPaymentSensitiveData({
      circular,
      error: new Error("provider secret sk_test_123"),
    })).toEqual({
      circular: {
        client_secret: "[REDACTED]",
        self: "[Circular]",
      },
      error: {
        name: "Error",
        message: "[REDACTED_ERROR_MESSAGE]",
      },
    });
  });
});

describe("provider retry classification", () => {
  it("classifies retryable provider failures", () => {
    expect(classifyProviderError({ status: 429 })).toBe("retryable");
    expect(classifyProviderError({ statusCode: 503 })).toBe("retryable");
    expect(classifyProviderError({ code: "api_connection_error" })).toBe("retryable");
    expect(classifyProviderError(new Error("request timed out"))).toBe("retryable");
  });

  it("classifies non-retryable provider failures", () => {
    expect(classifyProviderError({ status: 401 })).toBe("non_retryable");
    expect(classifyProviderError({ code: "card_declined" })).toBe("non_retryable");
    expect(classifyProviderError({ type: "invalid_request_error" })).toBe("non_retryable");
  });

  it("keeps unknown outcomes out of success paths", () => {
    expect(classifyProviderError(new Error("provider returned ambiguous response"))).toBe(
      "unknown_requires_reconciliation",
    );
  });

  it("calculates bounded exponential backoff", () => {
    expect(calculateRetryDelayMs(0, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(100);
    expect(calculateRetryDelayMs(2, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(400);
    expect(calculateRetryDelayMs(10, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(1_000);
  });
});

describe("payment reconciliation findings", () => {
  it("detects local/provider capture, amount, refund, and orphan mismatches", () => {
    const findings = detectPaymentReconciliationFindings(
      [
        {
          payment_intent_id: "pi_local_only",
          order_id: "ord_1",
          state: "captured",
          amount_minor: 1000,
          provider_reference: "prov_missing",
        },
        {
          payment_intent_id: "pi_provider_captured",
          order_id: "ord_2",
          state: "authorized",
          amount_minor: 2000,
          provider_reference: "prov_captured",
        },
        {
          payment_intent_id: "pi_refund",
          order_id: "ord_3",
          state: "partially_refunded",
          amount_minor: 3000,
          refunded_amount_minor: 500,
          provider_reference: "prov_refund",
        },
        {
          payment_intent_id: "pi_amount",
          order_id: "ord_4",
          state: "captured",
          amount_minor: 4000,
          provider_reference: "prov_amount",
        },
      ],
      [
        {
          provider_reference: "prov_captured",
          state: "captured",
          amount_minor: 2000,
        },
        {
          provider_reference: "prov_refund",
          state: "partially_refunded",
          amount_minor: 3000,
          refunded_amount_minor: 1000,
        },
        {
          provider_reference: "prov_amount",
          state: "captured",
          amount_minor: 4999,
        },
        {
          provider_reference: "prov_orphan",
          state: "captured",
          amount_minor: 1000,
        },
      ],
    );

    expect(findings.map((finding) => finding.type)).toEqual([
      "local_captured_provider_not_captured",
      "refund_mismatch",
      "amount_mismatch",
      "provider_captured_local_not_captured",
      "orphan_provider_payment",
    ]);
  });
});
