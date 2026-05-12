import { describe, expect, it } from "vitest";
import {
  resolveDisputeModuleSecretsFromEnv,
  signDisputeModulePayload,
  verifyDisputeModuleSignature,
} from "../services/dispute-module-auth.service.js";

const secret = "test-secret-with-enough-length";
const previousSecret = "previous-secret-with-enough-length";
const timestamp = "2026-05-05T12:00:00.000Z";
const nowMs = Date.parse(timestamp);
const rawBody = Buffer.from(JSON.stringify({ ok: true }));

function signed(overrides: Partial<Parameters<typeof verifyDisputeModuleSignature>[0]> = {}) {
  const signature = signDisputeModulePayload({
    secret,
    timestamp,
    method: "POST",
    path: "/modules/disputes/v1/cases/preview",
    rawBody,
  });

  return verifyDisputeModuleSignature({
    method: "POST",
    path: "/modules/disputes/v1/cases/preview",
    rawBody,
    platformId: "platform_1",
    timestamp,
    signature,
    idempotencyKey: "idem_12345678",
    nowMs,
    secretResolver: (platformId) => platformId === "platform_1" ? secret : null,
    ...overrides,
  });
}

describe("verifyDisputeModuleSignature", () => {
  it("accepts a valid signed module request", () => {
    expect(signed()).toMatchObject({
      ok: true,
      platformId: "platform_1",
      idempotencyKey: "idem_12345678",
    });
  });

  it("accepts any active rotation secret returned by the resolver", () => {
    const signature = signDisputeModulePayload({
      secret: previousSecret,
      timestamp,
      method: "POST",
      path: "/modules/disputes/v1/cases/preview",
      rawBody,
    });

    expect(signed({
      signature,
      secretResolver: (platformId) => platformId === "platform_1" ? [secret, previousSecret] : [],
    })).toMatchObject({
      ok: true,
      platformId: "platform_1",
    });
  });

  it("rejects missing auth headers", () => {
    expect(signed({ signature: undefined })).toMatchObject({
      ok: false,
      status: 401,
      error: "MISSING_MODULE_AUTH",
    });
  });

  it("rejects stale timestamps", () => {
    expect(signed({ nowMs: nowMs + 10 * 60 * 1000 })).toMatchObject({
      ok: false,
      status: 401,
      error: "MODULE_TIMESTAMP_OUT_OF_RANGE",
    });
  });

  it("rejects body tampering", () => {
    expect(signed({ rawBody: Buffer.from(JSON.stringify({ ok: false })) })).toMatchObject({
      ok: false,
      status: 401,
      error: "INVALID_MODULE_SIGNATURE",
    });
  });

  it("rejects weak idempotency keys", () => {
    expect(signed({ idempotencyKey: "short" })).toMatchObject({
      ok: false,
      status: 400,
      error: "INVALID_IDEMPOTENCY_KEY",
    });
  });

  it("resolves legacy and rotated platform secrets from env", () => {
    const original = process.env.DISPUTE_MODULE_PLATFORM_SECRETS;
    process.env.DISPUTE_MODULE_PLATFORM_SECRETS = JSON.stringify({
      legacy: secret,
      rotated: {
        current: "current-secret-with-enough-length",
        previous: [previousSecret, "short", previousSecret],
      },
      array: [secret, previousSecret],
    });

    try {
      expect(resolveDisputeModuleSecretsFromEnv("legacy")).toEqual([secret]);
      expect(resolveDisputeModuleSecretsFromEnv("rotated")).toEqual([
        "current-secret-with-enough-length",
        previousSecret,
      ]);
      expect(resolveDisputeModuleSecretsFromEnv("array")).toEqual([secret, previousSecret]);
      expect(resolveDisputeModuleSecretsFromEnv("missing")).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.DISPUTE_MODULE_PLATFORM_SECRETS;
      else process.env.DISPUTE_MODULE_PLATFORM_SECRETS = original;
    }
  });
});
