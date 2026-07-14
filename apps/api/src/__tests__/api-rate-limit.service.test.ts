import { describe, expect, it, vi } from "vitest";
import { consumeApiRateLimit } from "../services/api-rate-limit.service.js";

vi.unmock("@haggle/db");

describe("distributed API rate-limit counter", () => {
  it("returns an allowed result before the shared limit", async () => {
    const db = { execute: vi.fn().mockResolvedValue([{
      requestCount: 100,
      retryAfterSeconds: 19,
    }]) };
    await expect(consumeApiRateLimit(db as never, {
      scope: "global_ip",
      identity: "203.0.113.7",
      hmacSecret: "h".repeat(32),
    })).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      requestCount: 100,
    });
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it("blocks the capped overflow count and preserves retry timing", async () => {
    const db = { execute: vi.fn().mockResolvedValue([{
      requestCount: 101,
      retryAfterSeconds: 7,
    }]) };
    await expect(consumeApiRateLimit(db as never, {
      scope: "global_ip",
      identity: "203.0.113.8",
      hmacSecret: "h".repeat(32),
    })).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 7,
      requestCount: 101,
    });
  });

  it("rejects missing, malformed, and out-of-policy counter results", async () => {
    const missing = { execute: vi.fn().mockResolvedValue([]) };
    await expect(consumeApiRateLimit(missing as never, {
      scope: "global_ip", identity: "127.0.0.1", hmacSecret: "h".repeat(32),
    })).rejects.toThrow("API_RATE_LIMIT_COUNTER_NOT_RETURNED");

    const malformed = { execute: vi.fn().mockResolvedValue([{
      requestCount: "not-a-number", retryAfterSeconds: 1,
    }]) };
    await expect(consumeApiRateLimit(malformed as never, {
      scope: "global_ip", identity: "127.0.0.1", hmacSecret: "h".repeat(32),
    })).rejects.toThrow("API_RATE_LIMIT_COUNTER_INVALID");
  });

  it("validates custom bounds before accessing storage", async () => {
    const db = { execute: vi.fn() };
    await expect(consumeApiRateLimit(db as never, {
      scope: "global_ip", identity: "127.0.0.1", hmacSecret: "h".repeat(32),
      limit: 0,
    })).rejects.toThrow("INVALID_API_RATE_LIMIT_MAX_REQUESTS");
    await expect(consumeApiRateLimit(db as never, {
      scope: "global_ip", identity: "127.0.0.1", hmacSecret: "h".repeat(32),
      windowSeconds: 3601,
    })).rejects.toThrow("INVALID_API_RATE_LIMIT_WINDOW_SECONDS");
    expect(db.execute).not.toHaveBeenCalled();
  });
});
