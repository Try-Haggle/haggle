/**
 * C2 goldens: evaluate→createSession TOCTOU.
 *
 * Concurrent starts that both pass the early attempt gate must not silent
 * double-create. The race loser under withBuyerListingStartGate recheck must
 * name concurrent_on_listing — never listing_cooldown / ATTEMPT_COOLDOWN.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateAttemptControl,
  withBuyerListingStartGate,
} from "../services/attempt-control.service.js";

const BUYER_ID = "00000000-0000-4000-a000-000000000010";
const LISTING_ID = "00000000-0000-4000-a000-000000000001";
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
  const transaction = vi.fn(async (fn: (tx: { execute: typeof execute }) => unknown) =>
    fn({ execute }),
  );
  return { execute, transaction };
}

function expectNotCooldownBlock(result: {
  error?: string;
  rule?: string;
  allowed?: boolean;
  retryAfterSeconds?: number;
}) {
  expect(result.error).not.toBe("ATTEMPT_LIMIT_EXCEEDED");
  expect(result.error).not.toBe("ATTEMPT_COOLDOWN");
  expect(result.rule).not.toBe("listing_cooldown");
}

describe("C2 evaluate→createSession TOCTOU goldens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gate allows create when recheck still sees remaining>0·active0", async () => {
    const db = mockDb();
    const create = vi.fn(async () => ({ id: "sess-winner", status: "CREATED" }));

    const gated = await withBuyerListingStartGate(
      db as never,
      { buyerPrincipalId: BUYER_ID, listingId: LISTING_ID, nowMs: NOW_MS },
      async (_tx, attemptControl) => {
        const session = await create();
        return { session, attemptControl };
      },
    );

    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    expect(gated.value.session.id).toBe("sess-winner");
    expect(gated.attemptControl.active_sessions_on_listing).toBe(0);
    expect(gated.attemptControl.remaining_sessions).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledOnce();
    expect(db.transaction).toHaveBeenCalledOnce();
    // lock execute + evaluate execute
    expect(db.execute.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("race loser recheck names concurrent_on_listing, never cooldown", async () => {
    // Winner already inserted an active session; loser recheck under the lock sees it.
    const db = mockDb({
      active_sessions: 1,
      active_sessions_on_listing: 1,
      sessions_in_window: 2,
      marketplace_attempts_today: 1,
      last_listing_attempt_at: LAST_ATTEMPT_ISO,
    });
    const create = vi.fn(async () => ({ id: "sess-should-not-exist", status: "CREATED" }));

    const gated = await withBuyerListingStartGate(
      db as never,
      { buyerPrincipalId: BUYER_ID, listingId: LISTING_ID, nowMs: NOW_MS },
      async (_tx) => create(),
    );

    expect(gated.ok).toBe(false);
    if (gated.ok) return;
    expect(gated.attemptResult).toMatchObject({
      allowed: false,
      error: "CONCURRENT_SESSION_LIMIT_EXCEEDED",
      rule: "concurrent_on_listing",
    });
    expectNotCooldownBlock(gated.attemptResult);
    expect(gated.attemptResult.attemptControl.retry_after_seconds).toBe(3 * 3600);
    expect(gated.attemptResult.attemptControl.active_sessions_on_listing).toBe(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("overlapping early evaluates can both allow, but gated create serializes to one winner", async () => {
    // Early evaluate (pre-create) for both racers — B10 leftover cooldown shape.
    const earlyA = await evaluateAttemptControl(mockDb() as never, {
      buyerPrincipalId: BUYER_ID,
      listingId: LISTING_ID,
      nowMs: NOW_MS,
    });
    const earlyB = await evaluateAttemptControl(mockDb() as never, {
      buyerPrincipalId: BUYER_ID,
      listingId: LISTING_ID,
      nowMs: NOW_MS,
    });
    expect(earlyA.allowed).toBe(true);
    expect(earlyB.allowed).toBe(true);
    expectNotCooldownBlock(earlyA);
    expectNotCooldownBlock(earlyB);

    let activeOnListing = 0;

    // Serialize transactions like Postgres advisory locks would.
    let chain: Promise<unknown> = Promise.resolve();
    const sharedDb = {
      transaction: vi.fn(async (fn: (tx: { execute: ReturnType<typeof vi.fn> }) => unknown) => {
        const run = chain.then(async () => {
          let calls = 0;
          const execute = vi.fn(async () => {
            calls += 1;
            // First execute in the gate is the advisory lock; later is evaluate.
            if (calls === 1) return [];
            return [
              {
                active_sessions: activeOnListing,
                active_sessions_on_listing: activeOnListing,
                sessions_in_window: 1 + activeOnListing,
                marketplace_attempts_today: activeOnListing,
                last_listing_attempt_at: LAST_ATTEMPT_ISO,
              },
            ];
          });
          return fn({ execute });
        });
        chain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      }),
    };

    const creates: string[] = [];
    const [first, second] = await Promise.all([
      withBuyerListingStartGate(
        sharedDb as never,
        { buyerPrincipalId: BUYER_ID, listingId: LISTING_ID, nowMs: NOW_MS },
        async () => {
          activeOnListing += 1;
          creates.push("a");
          return { id: "sess-a" };
        },
      ),
      withBuyerListingStartGate(
        sharedDb as never,
        { buyerPrincipalId: BUYER_ID, listingId: LISTING_ID, nowMs: NOW_MS },
        async () => {
          activeOnListing += 1;
          creates.push("b");
          return { id: "sess-b" };
        },
      ),
    ]);

    const outcomes = [first, second];
    const winners = outcomes.filter((o) => o.ok);
    const losers = outcomes.filter((o) => !o.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(creates).toHaveLength(1);
    if (!losers[0] || losers[0].ok) return;
    expect(losers[0].attemptResult).toMatchObject({
      error: "CONCURRENT_SESSION_LIMIT_EXCEEDED",
      rule: "concurrent_on_listing",
    });
    expectNotCooldownBlock(losers[0].attemptResult);
  });
});
