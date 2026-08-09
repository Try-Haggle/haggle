/**
 * The band a party's own next offer is allowed to occupy.
 *
 * Every price fault reported from e2e was the engine proposing a number that ignored the
 * state of the negotiation, because the anchor was computed from `my_target` and
 * `my_floor` alone:
 *
 *  - A seller asking $120 answered a $95 offer with **$130** — the OPENING anchor is
 *    `my_target * (1 + margin)` and a seller's `my_target` IS the published asking price,
 *    so the formula deliberately quotes above the number the buyer is looking at.
 *  - A buyer who had opened at $200 came back with **$194** — the mirrored
 *    `my_target * (1 - margin)`, below their own standing offer.
 *
 * This module states the bounds those prices must respect. It is pure and role-aware; the
 * coach clamps its recommendation to it and the referee treats a breach as a HARD
 * violation, so a price is bounded whether it came from the engine, a skill, or the LLM.
 */

import type { CoreMemory } from "../types.js";

export interface PriceEnvelope {
  /** Lowest price this party may offer. */
  min: number;
  /** Highest price this party may offer. */
  max: number;
}

function isUsable(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Bounds for the acting party's next offer.
 *
 * Three rules, in order of how badly breaking them reads to a user:
 *
 * 1. **Stay inside your own limits.** A seller never quotes above the asking price they
 *    published — it is a public commitment, and exceeding it destroys trust. A buyer
 *    never offers above their budget.
 * 2. **Never move backwards.** A new offer may not be worse for the counterparty than
 *    this party's own previous one; a seller's prices only fall, a buyer's only rise.
 * 3. **Never cross the offer on the table.** A seller countering below what the buyer
 *    already offered (or a buyer above the seller's price) is strictly worse than
 *    accepting, and reads as not having listened.
 *
 * Asymmetry in rule 1 is deliberate: a seller's target is the PUBLISHED ask, so quoting
 * above it is dishonest, while a buyer's target is private and opening under it is
 * ordinary anchoring — for the buyer only their own previous offer bounds them below.
 */
export function computePriceEnvelope(memory: CoreMemory): PriceEnvelope {
  const { role } = memory.session;
  const { my_target: target, my_floor: floor, opponent_offer, my_last_offer } = memory.boundaries;

  let min: number;
  let max: number;

  if (role === "seller") {
    // `my_target` is the published ask and `my_floor` the walk-away.
    min = Math.min(target, floor);
    max = Math.max(target, floor);
    // The ask is a public commitment — never quote above it, and never above whatever
    // this seller has already come down to.
    max = Math.min(max, target);
    if (isUsable(my_last_offer)) max = Math.min(max, my_last_offer);
    // Undercutting the bid already on the table is strictly worse than accepting it.
    if (isUsable(opponent_offer)) min = Math.max(min, opponent_offer);
  } else {
    // A buyer's `my_floor` is their budget — the real ceiling. There is deliberately NO
    // lower bound from `my_target`: that number is private, so opening under it is
    // ordinary anchoring, unlike a seller quoting above a price the buyer can see.
    min = 0;
    max = Math.max(target, floor);
    max = Math.min(max, floor);
    if (isUsable(my_last_offer)) min = Math.max(min, my_last_offer);
    // Bidding past what the seller is asking is money given away.
    if (isUsable(opponent_offer)) max = Math.min(max, opponent_offer);
  }

  // The bounds crossed: the counterparty's price is already past anything we would
  // propose, so every counter is worse than accepting. Collapse onto the settling price
  // rather than emitting an inverted range, so clamps built on it stay well-defined.
  if (min > max) {
    const settle = role === "seller" ? Math.min(target, min) : Math.min(floor, max);
    return { min: settle, max: settle };
  }
  return { min, max };
}

/** Pull `price` into the envelope. */
export function clampToEnvelope(price: number, envelope: PriceEnvelope): number {
  if (!Number.isFinite(price)) return envelope.max;
  return Math.min(envelope.max, Math.max(envelope.min, price));
}

/** Whether `price` is outside the envelope (with a 1-minor-unit rounding tolerance). */
export function violatesEnvelope(price: number, envelope: PriceEnvelope): boolean {
  if (!Number.isFinite(price)) return false;
  return price < envelope.min - 1 || price > envelope.max + 1;
}
