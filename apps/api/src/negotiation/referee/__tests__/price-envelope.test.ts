/**
 * Bounds for a party's next offer, pinned against the two faults reported from e2e:
 * a seller asking $120 quoting $130, and a buyer who opened at $200 coming back at $194.
 */

import { describe, expect, it } from "vitest";
import type { CoreMemory, EngineDecision, NegotiationPhase } from "../../types.js";
import { clampToEnvelope, computePriceEnvelope, violatesEnvelope } from "../price-envelope.js";
import { validateMove } from "../validator.js";

/** Only the fields the envelope reads; the rest of CoreMemory is irrelevant here. */
function memory(
  role: "buyer" | "seller",
  boundaries: Partial<CoreMemory["boundaries"]>,
): CoreMemory {
  return {
    session: { role },
    boundaries: {
      my_target: 0,
      my_floor: 0,
      current_offer: 0,
      opponent_offer: 0,
      gap: 0,
      ...boundaries,
    },
    coaching: { recommended_price: 0 },
  } as CoreMemory;
}

describe("seller — the published ask is a ceiling", () => {
  // Asking $120, walk-away $80, buyer has offered $95.
  const base = { my_target: 12000, my_floor: 8000, opponent_offer: 9500, my_last_offer: 12000 };

  it("never allows a price above the asking price", () => {
    const env = computePriceEnvelope(memory("seller", base));
    expect(env.max).toBe(12000);
    // The reported number: OPENING anchor was 12000 * 1.1.
    expect(violatesEnvelope(13200, env)).toBe(true);
    expect(clampToEnvelope(13200, env)).toBe(12000);
  });

  it("never allows dropping below the buyer's standing offer", () => {
    // Countering under $95 is strictly worse than accepting the $95 already on the table.
    const env = computePriceEnvelope(memory("seller", base));
    expect(env.min).toBe(9500);
    expect(violatesEnvelope(9000, env)).toBe(true);
  });

  it("ratchets down: a later offer may not exceed this seller's own last one", () => {
    const env = computePriceEnvelope(memory("seller", { ...base, my_last_offer: 11000 }));
    expect(env.max).toBe(11000);
    expect(violatesEnvelope(11500, env)).toBe(true);
  });

  it("leaves a legitimate counter between the two prices alone", () => {
    const env = computePriceEnvelope(memory("seller", base));
    expect(violatesEnvelope(11000, env)).toBe(false);
    expect(clampToEnvelope(11000, env)).toBe(11000);
  });
});

describe("buyer — no moving backwards, no bidding past the seller", () => {
  // Target $200, budget $250, seller asking $250, buyer already offered $200.
  const base = { my_target: 20000, my_floor: 25000, opponent_offer: 25000, my_last_offer: 20000 };

  it("never allows an offer below this buyer's own last one", () => {
    const env = computePriceEnvelope(memory("buyer", base));
    expect(env.min).toBe(20000);
    // The reported number: OPENING anchor was 20000 * 0.97.
    expect(violatesEnvelope(19400, env)).toBe(true);
    expect(clampToEnvelope(19400, env)).toBe(20000);
  });

  it("never allows an offer above the seller's standing price", () => {
    // Bidding past the asking price is money thrown away.
    const env = computePriceEnvelope(memory("buyer", base));
    expect(env.max).toBe(25000);
    expect(violatesEnvelope(26000, env)).toBe(true);
  });

  it("caps at the budget when the seller is asking more than it", () => {
    const env = computePriceEnvelope(
      memory("buyer", { ...base, my_floor: 22000, opponent_offer: 25000 }),
    );
    expect(env.max).toBe(22000);
  });

  it("allows opening under target before this buyer has offered anything", () => {
    // A buyer's target is private, so anchoring under it is ordinary — unlike a seller,
    // whose ask is published. With no prior offer, `current_offer` is the target itself.
    const env = computePriceEnvelope(
      memory("buyer", {
        my_target: 20000,
        my_floor: 25000,
        opponent_offer: 25000,
        my_last_offer: 20000,
      }),
    );
    expect(env.min).toBe(20000);
    expect(violatesEnvelope(20500, env)).toBe(false);
  });
});

describe("degenerate inputs", () => {
  it("ignores an unset opponent offer instead of clamping onto zero", () => {
    const env = computePriceEnvelope(
      memory("seller", {
        my_target: 12000,
        my_floor: 8000,
        opponent_offer: 0,
        my_last_offer: 12000,
      }),
    );
    expect(env).toEqual({ min: 8000, max: 12000 });
  });

  it("collapses to the settling price when the offer on the table beats our limits", () => {
    // Buyer offering $130 on a $120 ask: every counter we could make is worse than
    // accepting, so the range must not invert.
    const env = computePriceEnvelope(
      memory("seller", {
        my_target: 12000,
        my_floor: 8000,
        opponent_offer: 13000,
        my_last_offer: 12000,
      }),
    );
    expect(env.min).toBe(env.max);
    expect(env.max).toBe(12000);
  });

  it("orders the limits regardless of which side is larger", () => {
    const seller = computePriceEnvelope(
      memory("seller", {
        my_target: 12000,
        my_floor: 8000,
        opponent_offer: 0,
        my_last_offer: 12000,
      }),
    );
    const buyer = computePriceEnvelope(
      memory("buyer", {
        my_target: 20000,
        my_floor: 25000,
        opponent_offer: 0,
        my_last_offer: 20000,
      }),
    );
    expect(seller.min).toBeLessThan(seller.max);
    expect(buyer.min).toBeLessThan(buyer.max);
  });

  it("never returns NaN for a non-finite price", () => {
    const env = computePriceEnvelope(
      memory("seller", {
        my_target: 12000,
        my_floor: 8000,
        opponent_offer: 9500,
        my_last_offer: 12000,
      }),
    );
    expect(clampToEnvelope(Number.NaN, env)).toBe(env.max);
    expect(violatesEnvelope(Number.NaN, env)).toBe(false);
  });
});

/**
 * V8 is the safety net for prices the coach never saw: a skill computing straight off
 * `boundaries`, or the LLM picking inside the harness box. Asserted through the real
 * `validateMove` so the wiring is covered, not just the pure function.
 */
describe("V8 — the referee blocks and repairs an out-of-envelope counter", () => {
  const seller = () =>
    memory("seller", {
      my_target: 12000, // published ask
      my_floor: 8000,
      opponent_offer: 9500, // buyer's standing bid
      my_last_offer: 12000,
    });

  const validate = (mem: CoreMemory, price: number, action: EngineDecision["action"]) =>
    validateMove(
      { action, price, reasoning: "test" },
      mem,
      mem.coaching,
      [],
      "BARGAINING" as NegotiationPhase,
    );

  it("blocks a seller countering above its own asking price", () => {
    const result = validate(seller(), 13000, "COUNTER");
    const v8 = result.violations.find((v) => v.rule === "V8");
    expect(v8?.severity).toBe("HARD");
    expect(result.hardPassed).toBe(false);
    expect(v8?.suggested_fix?.price).toBe(12000);
  });

  it("blocks a seller undercutting the bid already on the table", () => {
    const v8 = validate(seller(), 9000, "COUNTER").violations.find((v) => v.rule === "V8");
    expect(v8?.suggested_fix?.price).toBe(9500);
  });

  it("passes a counter that lands between the two prices", () => {
    const result = validate(seller(), 11000, "COUNTER");
    expect(result.violations.some((v) => v.rule === "V8")).toBe(false);
  });

  it("blocks a buyer moving backwards from its own last offer", () => {
    const buyer = memory("buyer", {
      my_target: 20000,
      my_floor: 25000,
      opponent_offer: 25000,
      my_last_offer: 20000,
    });
    const v8 = validate(buyer, 19400, "COUNTER").violations.find((v) => v.rule === "V8");
    expect(v8?.suggested_fix?.price).toBe(20000);
  });

  it("leaves ACCEPT alone — that price is the offer being accepted", () => {
    // The pipeline pins closing prices; bounding them here would fight that.
    const result = validate(seller(), 9500, "ACCEPT");
    expect(result.violations.some((v) => v.rule === "V8")).toBe(false);
  });
});
