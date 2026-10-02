import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateAttemptControl } from "../services/attempt-control.service.js";

const BUYER_ID = "00000000-0000-4000-a000-000000000010";
const LISTING_ID = "00000000-0000-4000-a000-000000000001";

function collectBoundPrimitives(
  node: unknown,
  out: unknown[] = [],
  seen = new WeakSet<object>(),
): unknown[] {
  if (node instanceof Date) {
    out.push(node);
    return out;
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    out.push(node);
    return out;
  }
  if (!node || typeof node !== "object" || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) collectBoundPrimitives(item, out, seen);
    return out;
  }
  for (const value of Object.values(node)) collectBoundPrimitives(value, out, seen);
  return out;
}

function mockDb(row: Record<string, unknown> = {}) {
  const execute = vi.fn().mockResolvedValue([
    {
      active_sessions: 0,
      active_sessions_on_listing: 0,
      sessions_in_window: 0,
      marketplace_attempts_today: 0,
      last_listing_attempt_at: null,
      ...row,
    },
  ]);
  return { execute };
}

describe("evaluateAttemptControl", () => {
  beforeEach(() => vi.stubEnv("HAGGLE_ENV", "production"));
  afterEach(() => vi.unstubAllEnvs());

  it("allows repeated staging starts under NODE_ENV=production with exhausted attempt budgets", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HAGGLE_ENV", "staging");
    const result = await evaluateAttemptControl(
      mockDb({
        sessions_in_window: 100,
        marketplace_attempts_today: 100,
        last_listing_attempt_at: "2026-10-02T23:00:00.000Z",
      }) as never,
      {
        buyerPrincipalId: BUYER_ID,
        listingId: LISTING_ID,
        nowMs: Date.parse("2026-10-02T23:07:00.000Z"),
      },
    );
    expect(result.allowed).toBe(true);
    expect(result.attemptControl.remaining_sessions).toBeGreaterThan(0);
    expect(result.attemptControl.remaining_marketplace_attempts).toBeGreaterThan(0);
    expect(result.attemptControl.retry_after_seconds).toBeNull();
    expect(result.attemptControl.max_rounds_per_session).toBe(10);
  });

  it("keeps staging concurrent-session protection", async () => {
    vi.stubEnv("HAGGLE_ENV", "staging");
    const result = await evaluateAttemptControl(
      mockDb({
        active_sessions_on_listing: 1,
        sessions_in_window: 100,
        marketplace_attempts_today: 100,
      }) as never,
      { buyerPrincipalId: BUYER_ID, listingId: LISTING_ID },
    );
    expect(result.error).toBe("CONCURRENT_SESSION_LIMIT_EXCEEDED");
  });

  it.each([
    "production",
    "local",
    "",
    "preview",
  ])("keeps the daily attempt cap outside staging (%s)", async (env) => {
    vi.stubEnv("HAGGLE_ENV", env);
    const result = await evaluateAttemptControl(
      mockDb({ marketplace_attempts_today: 5 }) as never,
      { buyerPrincipalId: BUYER_ID, listingId: LISTING_ID },
    );
    expect(result.error).toBe("MARKETPLACE_ATTEMPT_LIMIT_EXCEEDED");
  });

  it("binds ISO timestamps instead of Date objects", async () => {
    const db = mockDb();
    const nowMs = Date.parse("2026-09-01T12:00:00.000Z");

    await evaluateAttemptControl(db as never, {
      buyerPrincipalId: BUYER_ID,
      listingId: LISTING_ID,
      nowMs,
    });

    expect(db.execute).toHaveBeenCalledOnce();
    const values = collectBoundPrimitives(db.execute.mock.calls[0]?.[0]);
    expect(values.some((value) => value instanceof Date)).toBe(false);
    expect(values).toContain("2026-09-01T12:00:00.000Z");
    expect(values).toContain(BUYER_ID);
    expect(values).toContain(LISTING_ID);
  });

  it("allows a first start when the buyer has no sessions", async () => {
    const result = await evaluateAttemptControl(mockDb() as never, {
      buyerPrincipalId: BUYER_ID,
      listingId: LISTING_ID,
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks a second concurrent session on the same listing", async () => {
    const result = await evaluateAttemptControl(
      mockDb({ active_sessions: 1, active_sessions_on_listing: 1 }) as never,
      {
        buyerPrincipalId: BUYER_ID,
        listingId: LISTING_ID,
      },
    );
    expect(result).toMatchObject({
      allowed: false,
      error: "CONCURRENT_SESSION_LIMIT_EXCEEDED",
      rule: "concurrent_on_listing",
    });
  });

  it("does not 429 ATTEMPT_LIMIT with listing cooldown when remaining_sessions>0, marketplace remaining>0, and active 0", async () => {
    const nowMs = Date.parse("2026-09-02T12:00:00.000Z");
    // Default cooldown is 12h. Last attempt 9h ago => retry_after ~3h (joUdQ7Tw).
    const lastAttemptIso = new Date(nowMs - 9 * 3600 * 1000).toISOString();
    const result = await evaluateAttemptControl(
      mockDb({
        active_sessions: 0,
        active_sessions_on_listing: 0,
        sessions_in_window: 1,
        marketplace_attempts_today: 0,
        last_listing_attempt_at: lastAttemptIso,
      }) as never,
      {
        buyerPrincipalId: BUYER_ID,
        listingId: LISTING_ID,
        nowMs,
      },
    );
    expect(result.allowed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.error).not.toBe("ATTEMPT_LIMIT_EXCEEDED");
    expect(result.rule).not.toBe("listing_cooldown");
    expect(result.retryAfterSeconds).toBeUndefined();
    expect(result.attemptControl.remaining_sessions).toBe(2);
    expect(result.attemptControl.remaining_marketplace_attempts).toBe(5);
    expect(result.attemptControl.active_sessions).toBe(0);
    expect(result.attemptControl.active_sessions_on_listing).toBe(0);
    expect(result.attemptControl.retry_after_seconds).toBe(3 * 3600);
  });

  it("names the buyer listing window when remaining_sessions is 0", async () => {
    const result = await evaluateAttemptControl(
      mockDb({
        sessions_in_window: 3,
        marketplace_attempts_today: 0,
        last_listing_attempt_at: null,
      }) as never,
      {
        buyerPrincipalId: BUYER_ID,
        listingId: LISTING_ID,
      },
    );
    expect(result).toMatchObject({
      allowed: false,
      error: "ATTEMPT_WINDOW_EXCEEDED",
      rule: "buyer_listing_window",
    });
    expect(result.error).not.toBe("ATTEMPT_LIMIT_EXCEEDED");
  });
});
