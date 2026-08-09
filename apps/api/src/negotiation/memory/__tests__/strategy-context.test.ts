import { describe, expect, it } from "vitest";
import { extractStrategyContextMemory } from "../memory-reconstructor.js";

/**
 * Feature #4 wiring: each agent negotiates with ITS OWN quick-pick answers. The acting
 * side's advisor memory (buyer_* vs seller_*), which carries `categoryCriteria`, must be
 * the one hoisted into strategy_context — the DECIDE prompt (encodeStrategyContext) then
 * renders its required gates + preferences. This test locks the side-specific selection.
 */
describe("extractStrategyContextMemory — acting-side advisor selection (#4)", () => {
  const snapshot = {
    negotiation_agent_preset_id: "verifier",
    buyer_negotiation_agent_builder_memory: {
      categoryCriteria: [
        { checkId: "title_status", requirement: "required", stance: "clean title only" },
        { checkId: "mileage", requirement: "optional", stance: "max 60,000 miles" },
      ],
    },
    seller_negotiation_agent_builder_memory: {
      categoryCriteria: [
        { checkId: "title_status", requirement: "required", stance: "clean title, in hand" },
      ],
    },
  };

  it("hoists the BUYER's categoryCriteria on a buyer turn", () => {
    const ctx = extractStrategyContextMemory(snapshot, "buyer");
    const advisor = ctx?.negotiation_agent_builder_memory as
      | { categoryCriteria?: Array<{ checkId: string; stance?: string }> }
      | undefined;
    expect(advisor?.categoryCriteria?.map((c) => c.stance)).toEqual([
      "clean title only",
      "max 60,000 miles",
    ]);
  });

  it("hoists the SELLER's categoryCriteria on a seller turn (not the buyer's)", () => {
    const ctx = extractStrategyContextMemory(snapshot, "seller");
    const advisor = ctx?.negotiation_agent_builder_memory as
      | { categoryCriteria?: Array<{ checkId: string; stance?: string }> }
      | undefined;
    expect(advisor?.categoryCriteria?.map((c) => c.stance)).toEqual(["clean title, in hand"]);
  });

  it("returns undefined advisor memory when the acting side declared none", () => {
    const ctx = extractStrategyContextMemory(
      { seller_negotiation_agent_builder_memory: { categoryCriteria: [] } },
      "buyer",
    );
    // Buyer turn, but only seller memory present → no advisor hoisted for the buyer.
    expect(ctx?.negotiation_agent_builder_memory).toBeUndefined();
  });
});
