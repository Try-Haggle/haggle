/**
 * The coaching memory must carry the SAME live prices as the real one.
 *
 * `computeCoaching` clamps both its recommendation and its acceptable range to the price
 * envelope, and the envelope reads `opponent_offer` / `my_last_offer`. Those were fed to
 * `reconstructCoreMemory` but not to the throwaway memory the coach runs on, so every
 * recommendation — and the harness box the LLM then picks inside — was bounded against a
 * stale session-row price. The referee still caught the final number, which is exactly
 * what would have hidden this.
 */

import { describe, expect, it } from "vitest";
import type { DbSession } from "../../../lib/session-reconstructor.js";
import { buildInitialMemory } from "../executor.js";

const SESSION = {
  id: "s",
  role: "SELLER",
  status: "ACTIVE",
  currentRound: 2,
  roundsNoConcession: 0,
  // What the PREVIOUS round replied to — not the price now on the table.
  lastOfferPriceMinor: "12000",
  lastUtility: null,
  negotiationAgentSnapshot: { p_target: 12000, p_limit: 8000, max_rounds: 10 },
  createdAt: new Date(0),
  counterpartyId: "c",
  version: 1,
} as unknown as DbSession;

describe("buildInitialMemory carries the round's real prices", () => {
  it("uses the incoming offer as the opponent's price", () => {
    const memory = buildInitialMemory(SESSION, [], { incomingOfferMinor: 9500 });
    expect(memory.boundaries.opponent_offer).toBe(9500);
  });

  it("uses this side's measured last offer, not the session row", () => {
    const memory = buildInitialMemory(SESSION, [], {
      incomingOfferMinor: 9500,
      myLastOfferMinor: 11500,
    });
    expect(memory.boundaries.my_last_offer).toBe(11500);
    expect(memory.boundaries.current_offer).toBe(11500);
  });

  it("reports the real gap between the two standing prices", () => {
    // It used to set both sides to the same value, so `gap` was always 0 — and the
    // near-deal rule accepts when gap/range < 5%.
    const memory = buildInitialMemory(SESSION, [], {
      incomingOfferMinor: 9500,
      myLastOfferMinor: 11500,
    });
    expect(memory.boundaries.gap).toBe(2000);
  });

  it("leaves my_last_offer unset before this side has priced anything", () => {
    // The envelope must not confuse "no offer yet" with "offered exactly my target".
    const memory = buildInitialMemory(SESSION, [], { incomingOfferMinor: 9500 });
    expect(memory.boundaries.my_last_offer).toBeUndefined();
  });

  it("still works with no offers supplied", () => {
    const memory = buildInitialMemory(SESSION, []);
    expect(memory.boundaries.opponent_offer).toBe(12000);
    expect(memory.boundaries.my_last_offer).toBeUndefined();
  });
});
