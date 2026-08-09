/**
 * Whose price is in a round row.
 *
 * One row holds BOTH sides of an exchange — `priceminor` is what the SENDER offered,
 * `counterPriceMinor` what the responder answered with. Reading the wrong one made a
 * buyer's "own last offer" come back as the SELLER's price, so a paused round carried
 * the seller's $115 instead of the buyer's $96 and handed over the entire gap.
 */

import { describe, expect, it } from "vitest";
import type { DbRoundForMemory } from "../../memory/memory-reconstructor.js";
import { lastOutgoingOfferMinor } from "../executor.js";

function round(
  roundNo: number,
  senderRole: "BUYER" | "SELLER",
  priceminor: string,
  counterPriceMinor: string | null,
): DbRoundForMemory {
  return {
    roundNo,
    senderRole,
    priceminor,
    counterPriceMinor,
    decision: "COUNTER",
    utility: null,
    metadata: null,
    createdAt: new Date(0),
    coaching: null,
    phaseAtRound: null,
  };
}

// The reported transcript: buyer opens $96, seller counters $115.
const TRANSCRIPT = [round(1, "BUYER", "9600", "11500")];

describe("lastOutgoingOfferMinor", () => {
  it("reads the sender's own price off a round they sent", () => {
    expect(lastOutgoingOfferMinor(TRANSCRIPT, "BUYER")).toBe(9600);
  });

  it("reads the responder's price off a round they answered", () => {
    expect(lastOutgoingOfferMinor(TRANSCRIPT, "SELLER")).toBe(11500);
  });

  it("never returns the opponent's number as this side's own", () => {
    // The exact inversion that produced the $115 hold.
    expect(lastOutgoingOfferMinor(TRANSCRIPT, "BUYER")).not.toBe(11500);
  });

  it("takes the most recent priced round", () => {
    const rounds = [...TRANSCRIPT, round(2, "SELLER", "11500", "10000")];
    expect(lastOutgoingOfferMinor(rounds, "BUYER")).toBe(10000);
    expect(lastOutgoingOfferMinor(rounds, "SELLER")).toBe(11500);
  });

  it("skips rounds where this side never priced anything", () => {
    // A HOLD/REJECT round leaves counterPriceMinor null; keep looking further back.
    const rounds = [...TRANSCRIPT, round(2, "SELLER", "11500", null)];
    expect(lastOutgoingOfferMinor(rounds, "BUYER")).toBe(9600);
  });

  it("returns undefined before this side has priced anything", () => {
    expect(lastOutgoingOfferMinor([], "BUYER")).toBeUndefined();
    expect(lastOutgoingOfferMinor([round(1, "SELLER", "11500", null)], "BUYER")).toBeUndefined();
  });
});
