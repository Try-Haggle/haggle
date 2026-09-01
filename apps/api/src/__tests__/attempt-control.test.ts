import { describe, expect, it, vi } from "vitest";
import { evaluateAttemptControl } from "../services/attempt-control.service.js";

const BUYER_ID = "00000000-0000-4000-a000-000000000010";
const LISTING_ID = "00000000-0000-4000-a000-000000000001";

function sqlBoundValues(query: unknown): unknown[] {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  const values: unknown[] = [];
  for (const chunk of chunks) {
    if (chunk && typeof chunk === "object" && "value" in chunk) {
      values.push((chunk as { value: unknown }).value);
    }
  }
  return values;
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
  it("binds ISO timestamps instead of Date objects", async () => {
    const db = mockDb();
    const nowMs = Date.parse("2026-09-01T12:00:00.000Z");

    await evaluateAttemptControl(db as never, {
      buyerPrincipalId: BUYER_ID,
      listingId: LISTING_ID,
      nowMs,
    });

    expect(db.execute).toHaveBeenCalledOnce();
    const values = sqlBoundValues(db.execute.mock.calls[0]?.[0]);
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
    });
  });
});
