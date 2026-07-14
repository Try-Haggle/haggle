import { afterEach, describe, expect, it } from "vitest";
import {
  getApiRateLimitPolicyStatus,
  hashApiRateLimitIdentity,
  resolveApiRateLimitConfigFromEnv,
} from "../lib/api-rate-limit.js";

const keys = [
  "NODE_ENV",
  "VERCEL_ENV",
  "HAGGLE_ENV",
  "HAGGLE_API_RATE_LIMIT_MODE",
  "HAGGLE_API_RATE_LIMIT_HMAC_SECRET",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("API rate-limit configuration", () => {
  it("uses process-local limiting by default only in local development", () => {
    process.env.NODE_ENV = "development";
    process.env.HAGGLE_ENV = "local";
    delete process.env.HAGGLE_API_RATE_LIMIT_MODE;
    delete process.env.HAGGLE_API_RATE_LIMIT_HMAC_SECRET;
    expect(resolveApiRateLimitConfigFromEnv()).toEqual({ mode: "local" });
    expect(getApiRateLimitPolicyStatus()).toMatchObject({
      mode: "local",
      distributed: false,
      storage: "process_memory",
      containsSecret: false,
      containsIdentifiers: false,
      retention: { scheduled: false, intervalSeconds: 3600,
        retentionHours: 24, batchSize: 1000, runOnStart: true },
    });
  });

  it.each(["staging", "production"])(
    "requires PostgreSQL mode and a strong secret in %s",
    (haggleEnv) => {
      process.env.NODE_ENV = "production";
      process.env.HAGGLE_ENV = haggleEnv;
      process.env.HAGGLE_API_RATE_LIMIT_MODE = "local";
      delete process.env.HAGGLE_API_RATE_LIMIT_HMAC_SECRET;
      expect(() => resolveApiRateLimitConfigFromEnv())
        .toThrow(/postgres is required/);

      process.env.HAGGLE_API_RATE_LIMIT_MODE = "postgres";
      process.env.HAGGLE_API_RATE_LIMIT_HMAC_SECRET = "short";
      expect(() => resolveApiRateLimitConfigFromEnv())
        .toThrow(/32 to 512 bytes/);

      process.env.HAGGLE_API_RATE_LIMIT_HMAC_SECRET = "s".repeat(32);
      expect(resolveApiRateLimitConfigFromEnv()).toEqual({
        mode: "postgres",
        hmacSecret: "s".repeat(32),
      });
    },
  );

  it("creates stable scoped hashes without retaining the identity", () => {
    const input = {
      scope: "global_ip",
      identity: "203.0.113.42",
      hmacSecret: "h".repeat(32),
    };
    const first = hashApiRateLimitIdentity(input);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain(input.identity);
    expect(hashApiRateLimitIdentity(input)).toBe(first);
    expect(hashApiRateLimitIdentity({ ...input, scope: "payments" }))
      .not.toBe(first);
  });

  it("rejects invalid modes, scopes, identities, and oversized secrets", () => {
    process.env.NODE_ENV = "development";
    process.env.HAGGLE_ENV = "local";
    process.env.HAGGLE_API_RATE_LIMIT_MODE = "redis";
    expect(() => resolveApiRateLimitConfigFromEnv()).toThrow(/local or postgres/);
    expect(() => hashApiRateLimitIdentity({
      scope: "contains space",
      identity: "127.0.0.1",
      hmacSecret: "h".repeat(32),
    })).toThrow("INVALID_API_RATE_LIMIT_SCOPE");
    expect(() => hashApiRateLimitIdentity({
      scope: "global_ip",
      identity: "x".repeat(513),
      hmacSecret: "h".repeat(32),
    })).toThrow("INVALID_API_RATE_LIMIT_IDENTITY");
    process.env.HAGGLE_API_RATE_LIMIT_MODE = "postgres";
    process.env.HAGGLE_API_RATE_LIMIT_HMAC_SECRET = "h".repeat(513);
    expect(() => resolveApiRateLimitConfigFromEnv())
      .toThrow(/32 to 512 bytes/);
  });
});
