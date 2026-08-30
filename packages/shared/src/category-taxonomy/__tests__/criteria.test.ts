import { describe, expect, it } from "vitest";
import {
  buildBuyerChoiceQuestions,
  buildCategoryCriteriaScaffold,
  buildSellerChoiceQuestions,
  type CategoryCriterion,
  criterionAnswered,
  requiredCriteria,
  resolveBuyerChoiceOption,
  unansweredHardCriteria,
  unresolvedSellerRequirements,
} from "../criteria.js";

/** Convenience: build a criterion with overrides. */
function criterion(overrides: Partial<CategoryCriterion> & { checkId: string }): CategoryCriterion {
  return {
    questionKo: "q",
    enforcement: "soft",
    requirement: "optional",
    ...overrides,
  };
}

describe("buildCategoryCriteriaScaffold", () => {
  it("maps a vehicle listing's checks to criteria with hard→required defaults", () => {
    const criteria = buildCategoryCriteriaScaffold(["vehicles"]);
    const byId = new Map(criteria.map((c) => [c.checkId, c]));

    // title_status is a hard taxonomy check → defaults to required.
    expect(byId.get("title_status")?.requirement).toBe("required");
    expect(byId.get("title_status")?.enforcement).toBe("hard");
    // mileage/service_history are soft → optional.
    expect(byId.get("mileage")?.requirement).toBe("optional");
    expect(byId.get("service_history")?.requirement).toBe("optional");
  });

  it("carries the check's buyerAskKo when present and omits it otherwise", () => {
    const criteria = buildCategoryCriteriaScaffold(["vehicles"]);
    const title = criteria.find((c) => c.checkId === "title_status");
    expect(title?.buyerAskKo).toBe("Should the agent only consider clean-title vehicles?");
  });

  it("inherits ancestor checks for a hyphenated real-listing tag (iphone-15-pro)", () => {
    const criteria = buildCategoryCriteriaScaffold(["electronics", "iphone-15-pro"]);
    const ids = criteria.map((c) => c.checkId);
    // iPhone node + ancestors: working/cosmetic (electronics), battery/carrier/storage
    // (phones), imei/find_my (iphone). imei + find_my are hard → required.
    expect(ids).toContain("imei_verification");
    expect(ids).toContain("battery_health");
    expect(ids).toContain("working_status");
    const imei = criteria.find((c) => c.checkId === "imei_verification");
    expect(imei?.requirement).toBe("required");
  });

  it("never emits a stance in the scaffold (nothing answered yet)", () => {
    const criteria = buildCategoryCriteriaScaffold(["vehicles"]);
    expect(criteria.every((c) => c.stance === undefined)).toBe(true);
  });

  it("returns [] for tags with no taxonomy node", () => {
    // "other" is a canonical listing category with no taxonomy node.
    expect(buildCategoryCriteriaScaffold(["other", "misc"])).toEqual([]);
    expect(buildCategoryCriteriaScaffold([])).toEqual([]);
  });
});

describe("unansweredHardCriteria", () => {
  it("lists every open HARD until it has a stance", () => {
    const tags = ["electronics", "iphone-15-pro"];
    const missing = unansweredHardCriteria(tags, []);
    expect(missing.map((c) => c.checkId)).toContain("imei_verification");
    expect(
      unansweredHardCriteria(tags, [
        criterion({
          checkId: "imei_verification",
          enforcement: "hard",
          requirement: "required",
          stance: "clean IMEI, not blacklisted, verifiable",
        }),
      ]).map((c) => c.checkId),
    ).not.toContain("imei_verification");
  });

  it("does not invent IMEI for AirPods", () => {
    const missing = unansweredHardCriteria(["electronics", "airpods"], []);
    expect(missing.map((c) => c.checkId)).not.toContain("imei_verification");
    expect(missing.map((c) => c.checkId)).toEqual(
      expect.arrayContaining(["counterfeit_authenticity", "find_my_unpaired"]),
    );
  });
});

describe("criterionAnswered", () => {
  it("is false for missing/blank stance and true for real content", () => {
    expect(criterionAnswered(criterion({ checkId: "a" }))).toBe(false);
    expect(criterionAnswered(criterion({ checkId: "a", stance: "" }))).toBe(false);
    expect(criterionAnswered(criterion({ checkId: "a", stance: "   " }))).toBe(false);
    expect(criterionAnswered(criterion({ checkId: "a", stance: "clean only" }))).toBe(true);
  });
});

describe("requiredCriteria", () => {
  it("keeps only required and dedupes by checkId (first wins)", () => {
    const result = requiredCriteria([
      criterion({ checkId: "title_status", requirement: "required", stance: "clean" }),
      criterion({ checkId: "mileage", requirement: "optional" }),
      criterion({ checkId: "title_status", requirement: "required", stance: "dup" }),
    ]);
    expect(result.map((c) => c.checkId)).toEqual(["title_status"]);
    expect(result[0]?.stance).toBe("clean");
  });

  it("returns [] when nothing is required", () => {
    expect(requiredCriteria([criterion({ checkId: "mileage" })])).toEqual([]);
  });
});

describe("unresolvedSellerRequirements", () => {
  const sellerCriteria: CategoryCriterion[] = [
    criterion({ checkId: "title_status", requirement: "required", stance: "clean title only" }),
    criterion({ checkId: "service_history", requirement: "required", stance: "full history" }),
    criterion({ checkId: "mileage", requirement: "optional", stance: "under 50k" }),
  ];

  it("flags seller-required checks the buyer never addressed", () => {
    const buyerCriteria: CategoryCriterion[] = [
      criterion({ checkId: "title_status", requirement: "required", stance: "clean is fine" }),
      // service_history NOT addressed by the buyer.
    ];
    const unresolved = unresolvedSellerRequirements(sellerCriteria, buyerCriteria);
    expect(unresolved.map((c) => c.checkId)).toEqual(["service_history"]);
  });

  it("treats a blank buyer stance as unaddressed", () => {
    const buyerCriteria: CategoryCriterion[] = [
      criterion({ checkId: "title_status", requirement: "required", stance: "   " }),
      criterion({ checkId: "service_history", requirement: "optional", stance: "full history" }),
    ];
    const unresolved = unresolvedSellerRequirements(sellerCriteria, buyerCriteria);
    // title_status blank → still unresolved; service_history answered (any requirement).
    expect(unresolved.map((c) => c.checkId)).toEqual(["title_status"]);
  });

  it("ignores seller OPTIONAL criteria even when unaddressed", () => {
    const unresolved = unresolvedSellerRequirements(sellerCriteria, []);
    // Only the two required checks surface; optional mileage never pauses.
    expect(unresolved.map((c) => c.checkId).sort()).toEqual(["service_history", "title_status"]);
  });

  it("returns [] when the buyer addressed every seller requirement", () => {
    const buyerCriteria: CategoryCriterion[] = [
      criterion({ checkId: "title_status", stance: "clean only" }),
      criterion({ checkId: "service_history", stance: "prefer history" }),
    ];
    expect(unresolvedSellerRequirements(sellerCriteria, buyerCriteria)).toEqual([]);
  });
});

describe("buildBuyerChoiceQuestions (deterministic multiple-choice layer)", () => {
  it("surfaces a vehicle's checks that have answer options, buyer-framed", () => {
    const questions = buildBuyerChoiceQuestions(["vehicles"]);
    const byId = new Map(questions.map((q) => [q.checkId, q]));

    // The vehicle spine's key gates all carry options.
    expect([...byId.keys()]).toEqual(
      expect.arrayContaining(["mileage", "title_status", "lien_status", "vin_theft_check"]),
    );
    const title = byId.get("title_status")!;
    expect(title.question).toBe("Should the agent only consider clean-title vehicles?");
    expect(title.options.map((o) => o.label)).toEqual([
      "Clean title only",
      "Salvage/rebuilt OK",
      "Doesn't matter",
    ]);
    // The deal-breaker option is required; the waivers are optional.
    expect(title.options[0]?.requirement).toBe("required");
    expect(title.options[1]?.requirement).toBe("optional");
  });

  it("orders hard (deal-breaker) questions before soft ones (most-important-first)", () => {
    const questions = buildBuyerChoiceQuestions(["vehicles"]);
    const firstSoftIdx = questions.findIndex((q) => q.enforcement === "soft");
    const lastHardIdx = questions.map((q) => q.enforcement).lastIndexOf("hard");
    // Every hard question comes before the first soft one.
    expect(lastHardIdx).toBeLessThan(firstSoftIdx);
    expect(questions[0]?.enforcement).toBe("hard");
  });

  it("omits checks without options (free-text stays free-text)", () => {
    // A MacBook's battery_cycles / spec_summary are free-text (no options) → omitted.
    const ids = buildBuyerChoiceQuestions(["electronics", "macbook-pro-14"]).map((q) => q.checkId);
    expect(ids).not.toContain("battery_cycles");
    expect(ids).not.toContain("spec_summary");
    // ...but the MacBook's hard gates DO carry options.
    expect(ids).toContain("boots_ok");
  });

  it("inherits ancestor options for a hyphenated real tag (iphone-15-pro → IMEI)", () => {
    const ids = buildBuyerChoiceQuestions(["electronics", "iphone-15-pro"]).map((q) => q.checkId);
    expect(ids).toContain("imei_verification");
  });

  it("dedupes by check id", () => {
    const questions = buildBuyerChoiceQuestions(["vehicles", "vehicles"]);
    const titleCount = questions.filter((q) => q.checkId === "title_status").length;
    expect(titleCount).toBe(1);
  });
});

describe("buildSellerChoiceQuestions (seller states the fact, English-framed)", () => {
  it("surfaces a vehicle's hard gate with seller options + English question", () => {
    const questions = buildSellerChoiceQuestions(["vehicles"]);
    const title = questions.find((q) => q.checkId === "title_status");
    expect(title?.question).toBe("What's the title status?");
    expect(title?.options.map((o) => o.label)).toEqual(["Clean title", "Salvage/rebuilt"]);
    // Hard gates are pinned required on the seller side (buyer must address them).
    expect(title?.options.every((o) => o.requirement === "required")).toBe(true);
    // Carries buyerAskKo so a chosen answer builds a complete criterion.
    expect(title?.buyerAskKo).toBe("Should the agent only consider clean-title vehicles?");
  });

  it("omits soft checks with no seller options (mileage → seller types it)", () => {
    // Soft checks the seller CAN state as a fact now carry seller options; only
    // mileage stays free-text, so a bucket pill can't blur the exact odometer reading.
    // See seller-buyer-option-parity.test.ts for the full invariant.
    const ids = buildSellerChoiceQuestions(["vehicles"]).map((q) => q.checkId);
    expect(ids).not.toContain("mileage");
    expect(ids).toContain("service_history");
    expect(ids).toContain("accident_history");
  });

  it("inherits ancestor seller options for a hyphenated tag (iphone-15-pro → IMEI)", () => {
    const ids = buildSellerChoiceQuestions(["electronics", "iphone-15-pro"]).map((q) => q.checkId);
    expect(ids).toContain("imei_verification");
  });
});

describe("resolveBuyerChoiceOption (server-side re-resolution, never trusts client)", () => {
  it("returns the canonical option for a valid check + label", () => {
    const opt = resolveBuyerChoiceOption(["vehicles"], "title_status", "Clean title only");
    expect(opt).toEqual({
      label: "Clean title only",
      stance: "clean title only",
      requirement: "required",
    });
  });

  it("returns undefined for an unknown label or check id", () => {
    expect(resolveBuyerChoiceOption(["vehicles"], "title_status", "Made up")).toBeUndefined();
    expect(
      resolveBuyerChoiceOption(["vehicles"], "not_a_check", "Clean title only"),
    ).toBeUndefined();
  });
});
