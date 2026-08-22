import { describe, expect, it } from "vitest";
import { type CategoryCriterion, sellerProductFacts } from "../criteria.js";

/** Convenience: build a criterion with overrides. */
function criterion(overrides: Partial<CategoryCriterion> & { checkId: string }): CategoryCriterion {
  return {
    questionKo: "q",
    enforcement: "soft",
    requirement: "optional",
    ...overrides,
  };
}

describe("sellerProductFacts", () => {
  it("publishes a canonical option as a label/value spec card", () => {
    const facts = sellerProductFacts([
      criterion({ checkId: "storage_capacity", stance: "256GB storage" }),
    ]);

    expect(facts).toEqual([
      { checkId: "storage_capacity", label: "Storage capacity", value: "256GB" },
    ]);
  });

  it("works for non-phone categories — the phone-only wizard path never could", () => {
    const facts = sellerProductFacts([
      criterion({ checkId: "boots_ok", stance: "powers on and boots to OS" }),
    ]);

    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe("Boots fine");
  });

  it("drops free-text stances: prose can carry intent, canonical options cannot", () => {
    const facts = sellerProductFacts([
      criterion({
        checkId: "storage_capacity",
        stance: "256GB, and I won't go below $900 for it",
      }),
    ]);

    expect(facts).toEqual([]);
  });

  it("drops checks that define no seller options at all", () => {
    // `gpu_model_vram` is free-text in the taxonomy — nothing to match against.
    const facts = sellerProductFacts([
      criterion({ checkId: "gpu_model_vram", stance: "RTX 4070 8GB" }),
    ]);

    expect(facts).toEqual([]);
  });

  it("ignores unanswered criteria", () => {
    expect(
      sellerProductFacts([
        criterion({ checkId: "storage_capacity" }),
        criterion({ checkId: "carrier_lock", stance: "   " }),
      ]),
    ).toEqual([]);
  });

  it("publishes unflattering facts — a buyer is entitled to them before negotiating", () => {
    const facts = sellerProductFacts([
      criterion({ checkId: "screen_condition", stance: "screen cracked or has dead pixels" }),
    ]);

    expect(facts[0]?.value).toBe("Cracked / dead pixels");
  });

  it("emits the same fact regardless of the seller's requirement posture", () => {
    const asRequired = sellerProductFacts([
      criterion({ checkId: "carrier_lock", stance: "carrier-unlocked", requirement: "required" }),
    ]);
    const asOptional = sellerProductFacts([
      criterion({ checkId: "carrier_lock", stance: "carrier-unlocked", requirement: "optional" }),
    ]);

    expect(asRequired).toEqual(asOptional);
    expect(asRequired[0]?.value).toBe("Unlocked");
  });

  it("dedupes by check id, first answer wins", () => {
    const facts = sellerProductFacts([
      criterion({ checkId: "storage_capacity", stance: "256GB storage" }),
      criterion({ checkId: "storage_capacity", stance: "512GB storage" }),
    ]);

    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe("256GB");
  });

  it("states the label instead of asking it", () => {
    // `title_status`'s ask is the taxonomy's one fully-interrogative phrasing:
    // "What's the title status?". Left alone it renders as a card reading
    // "What's the title status | Clean title".
    const facts = sellerProductFacts([
      criterion({ checkId: "title_status", stance: "clean title, in hand" }),
    ]);

    expect(facts[0]?.label).toBe("Title status");
  });

  it("leaves noun-phrase labels alone apart from the question mark", () => {
    // The other 115 option-bearing checks are already noun phrases; the
    // interrogative strip must not chew into them.
    const facts = sellerProductFacts([
      criterion({ checkId: "battery_health", stance: "battery health 90% or higher" }),
    ]);

    expect(facts[0]?.label).toBe("Battery health");
  });

  it("never emits a label still carrying its question mark", () => {
    const facts = sellerProductFacts([
      criterion({ checkId: "carrier_lock", stance: "carrier-unlocked" }),
      criterion({ checkId: "battery_health", stance: "battery health 90% or higher" }),
    ]);

    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) expect(fact.label).not.toMatch(/\?$/);
  });
});
