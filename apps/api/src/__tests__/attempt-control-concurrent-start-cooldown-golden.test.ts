/**
 * B10 goldens: concurrent / overlapping start must not false-block via listing_cooldown
 * when remaining_sessions>0 and active_sessions==0 (joUdQ7Tw / #111 regression).
 *
 * Fixtures cover:
 * 1. leftover last_listing_attempt_at inside 12h cooldown + remaining>0 + active 0 → allow
 * 2. concurrent overlapping evaluateAttemptControl calls with the same leftover cooldown → both allow
 * 3. loser of concurrent race (active_on_listing already 1) → concurrent_on_listing, never listing_cooldown
 * 4. never emit ATTEMPT_COOLDOWN / listing_cooldown / ATTEMPT_LIMIT_EXCEEDED for (1)–(3)
 */
import { describe, expect, it, vi } from "vitest";
import { evaluateAttemptControl } from "../services/attempt-control.service.js";

const BUYER_ID = "00000000-0000-4000-a000-000000000010";
const LISTING_ID = "00000000-0000-4000-a000-000000000001";

/** joUdQ7Tw-shaped leftover: last attempt 9h ago under default 12h cooldown. */
const NOW_MS = Date.parse("2026-09-02T12:00:00.000Z");
const LAST_ATTEMPT_ISO = new Date(NOW_MS - 9 * 3600 * 1000).toISOString();

function mockDb(row: Record<string, unknown> = {}) {
  const execute = vi.fn().mockResolvedValue([
    {
      active_sessions: 0,
      active_sessions_on_listing: 0,
      sessions_in_window: 1,
      marketplace_attempts_today: 0,
      last_listing_attempt_at: LAST_ATTEMPT_ISO,
      ...row,
    },
  ]);
  return { execute };
}

function expectNotCooldownBlock(result: Awaited<ReturnType<typeof evaluateAttemptControl>>) {
  expect(result.error).not.toBe("ATTEMPT_LIMIT_EXCEEDED");
  expect(result.error).not.toBe("ATTEMPT_COOLDOWN");
  expect(result.rule).not.toBe("listing_cooldown");
  if (result.allowed) {
    expect(result.retryAfterSeconds).toBeUndefined();
  }
}

describe("B10 concurrent start / listing_cooldown goldens", () => {
  it("remaining>0 + active 0 + leftover cooldown allows a legitimate start (joUdQ7Tw)", async () => {
    const result = await evaluateAttemptControl(
      mockDb({
        active_sessions: 0,
        active_sessions_on_listing: 0,
        sessions_in_window: 1,
        marketplace_attempts_today: 0,
        last_listing_attempt_at: LAST_ATTEMPT_ISO,
      }) as never,
      {
        buyerPrincipalId: BUYER_ID,
        listingId: LISTING_ID,
        nowMs: NOW_MS,
      },
    );

    expect(result.allowed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.rule).toBeUndefined();
    expectNotCooldownBlock(result);
    expect(result.attemptControl.remaining_sessions).toBe(2);
    expect(result.attemptControl.remaining_marketplace_attempts).toBe(5);
    expect(result.attemptControl.active_sessions).toBe(0);
    expect(result.attemptControl.active_sessions_on_listing).toBe(0);
    // Snapshot may still expose cooldown remaining for UX; it must not block.
    expect(result.attemptControl.retry_after_seconds).toBe(3 * 3600);
  });

  it("overlapping concurrent starts with remaining>0·active0 do not false-block via listing_cooldown", async () => {
    const dbA = mockDb();
    const dbB = mockDb();

    const [first, second] = await Promise.all([
      evaluateAttemptControl(dbA as never, {
        buyerPrincipalId: BUYER_ID,
        listingId: LISTING_ID,
        nowMs: NOW_MS,
      }),
      evaluateAttemptControl(dbB as never, {
        buyerPrincipalId: BUYER_ID,
        listingId: LISTING_ID,
        nowMs: NOW_MS,
      }),
    ]);

    for (const result of [first, second]) {
      expect(result.allowed).toBe(true);
      expectNotCooldownBlock(result);
      expect(result.attemptControl.remaining_sessions).toBeGreaterThan(0);
      expect(result.attemptControl.active_sessions).toBe(0);
      expect(result.attemptControl.active_sessions_on_listing).toBe(0);
    }
    expect(dbA.execute).toHaveBeenCalledOnce();
    expect(dbB.execute).toHaveBeenCalledOnce();
  });

  it("concurrent race loser names concurrent_on_listing, never listing_cooldown", async () => {
    // First start already created an active session; second overlapping evaluate sees it.
    const result = await evaluateAttemptControl(
      mockDb({
        active_sessions: 1,
        active_sessions_on_listing: 1,
        sessions_in_window: 2,
        marketplace_attempts_today: 1,
        last_listing_attempt_at: LAST_ATTEMPT_ISO,
      }) as never,
      {
        buyerPrincipalId: BUYER_ID,
        listingId: LISTING_ID,
        nowMs: NOW_MS,
      },
    );

    expect(result).toMatchObject({
      allowed: false,
      error: "CONCURRENT_SESSION_LIMIT_EXCEEDED",
      rule: "concurrent_on_listing",
    });
    expectNotCooldownBlock(result);
    // Cooldown leftover must not rewrite the concurrent block into ATTEMPT_COOLDOWN.
    expect(result.attemptControl.retry_after_seconds).toBe(3 * 3600);
    expect(result.attemptControl.active_sessions_on_listing).toBe(1);
    expect(result.attemptControl.remaining_sessions).toBe(1);
  });

  it("never returns listing_cooldown even when cooldown remaining and window almost exhausted", async () => {
    const result = await evaluateAttemptControl(
      mockDb({
        active_sessions: 0,
        active_sessions_on_listing: 0,
        sessions_in_window: 2,
        marketplace_attempts_today: 4,
        last_listing_attempt_at: LAST_ATTEMPT_ISO,
      }) as never,
      {
        buyerPrincipalId: BUYER_ID,
        listingId: LISTING_ID,
        nowMs: NOW_MS,
      },
    );

    expect(result.allowed).toBe(true);
    expectNotCooldownBlock(result);
    expect(result.attemptControl.remaining_sessions).toBe(1);
    expect(result.attemptControl.remaining_marketplace_attempts).toBe(1);
  });
});
