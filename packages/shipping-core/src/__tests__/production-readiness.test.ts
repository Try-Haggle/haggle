import { describe, expect, it } from "vitest";
import {
  calculateCarrierRetryDelayMs,
  classifyCarrierError,
  redactShippingSensitiveData,
} from "../production-readiness.js";

describe("shipping production readiness helpers", () => {
  it("redacts shipping PII and carrier secrets recursively", () => {
    expect(redactShippingSensitiveData({
      carrier: "USPS",
      to_address: {
        name: "Buyer",
        street1: "1 Main St",
        city: "Denver",
        zip: "80202",
      },
      webhook_signature: "hmac-secret",
      nested: [{ phone: "555-0100", status: "DELIVERED" }],
    })).toEqual({
      carrier: "USPS",
      to_address: "[REDACTED]",
      webhook_signature: "[REDACTED]",
      nested: [{ phone: "[REDACTED]", status: "DELIVERED" }],
    });
  });

  it("handles circular objects and Error instances", () => {
    const value: Record<string, unknown> = { street1: "1 Main St" };
    value.self = value;

    expect(redactShippingSensitiveData({
      value,
      error: new Error("EasyPost secret leak"),
    })).toEqual({
      value: {
        street1: "[REDACTED]",
        self: "[Circular]",
      },
      error: {
        name: "Error",
        message: "[REDACTED_ERROR_MESSAGE]",
      },
    });
  });

  it("classifies carrier errors for bounded retries", () => {
    expect(classifyCarrierError({ status: 429 })).toBe("retryable");
    expect(classifyCarrierError({ statusCode: 503 })).toBe("retryable");
    expect(classifyCarrierError({ status: 401 })).toBe("non_retryable");
    expect(classifyCarrierError(new Error("request timed out"))).toBe("retryable");
    expect(classifyCarrierError(new Error("ambiguous carrier response"))).toBe("unknown_requires_reconciliation");
  });

  it("calculates bounded retry delay", () => {
    expect(calculateCarrierRetryDelayMs(0, { baseDelayMs: 100, maxDelayMs: 500 })).toBe(100);
    expect(calculateCarrierRetryDelayMs(2, { baseDelayMs: 100, maxDelayMs: 500 })).toBe(400);
    expect(calculateCarrierRetryDelayMs(10, { baseDelayMs: 100, maxDelayMs: 500 })).toBe(500);
  });
});
