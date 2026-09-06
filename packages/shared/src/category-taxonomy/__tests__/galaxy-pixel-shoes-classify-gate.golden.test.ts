/**
 * A10/D3 goldens — galaxy / pixel taxonomy: classification + HARD gate reject/pass.
 *
 * D3 (CTO feedback): shoes/sneakers HARD authenticity path removed. Electronics only —
 * galaxy/pixel/phone HARD remain. dead-pixel / no-dead-pixel must not open phone gates
 * (AMBIGUOUS_MATCH_TOKENS). Shoes must NOT classify to sneakers HARD / unansweredHard
 * authenticity (sneaker_authenticity).
 *
 * Classification = enrichTagsWithTaxonomy / inferTaxonomyTags → resolveChecks.
 * Gate = unansweredHardCriteria (reject when HARD unanswered; pass when answered).
 * No money / session / play paths.
 */

import { describe, expect, it } from "vitest";
import {
  type CategoryCriterion,
  enrichTagsWithTaxonomy,
  inferTaxonomyTags,
  unansweredHardCriteria,
} from "../index.js";
import { resolveChecks } from "../taxonomy.js";

const hardIds = (tags: readonly string[]) =>
  resolveChecks(tags)
    .filter((c) => c.enforcement === "hard")
    .map((c) => c.id);

function answered(checkId: string, stance = "confirmed"): CategoryCriterion {
  return {
    checkId,
    questionKo: "q",
    enforcement: "hard",
    requirement: "required",
    stance,
  };
}

describe("A10/D3 classify — galaxy / pixel (electronics); shoes must not open sneakers HARD", () => {
  it("Galaxy S24 title classifies into samsung phone HARD gates", () => {
    const { tags, inferred } = enrichTagsWithTaxonomy(
      ["electronics"],
      "Samsung Galaxy S24 Ultra 512GB Unlocked",
    );
    expect(inferred.length).toBeGreaterThan(0);
    expect(hardIds(tags)).toEqual(
      expect.arrayContaining([
        "imei_verification",
        "google_frp_lock",
        "samsung_reactivation_lock",
        "financing_paid_off",
        "water_damage",
      ]),
    );
    expect(hardIds(tags)).not.toContain("find_my_status");
    expect(hardIds(tags)).not.toContain("sneaker_authenticity");
  });

  it("Pixel 8 Pro without the word Google still classifies (pixel 8 alias)", () => {
    const inferred = inferTaxonomyTags("Pixel 8 Pro 128GB Unlocked");
    expect(inferred.some((t) => t.includes("pixel"))).toBe(true);
    const { tags } = enrichTagsWithTaxonomy(["electronics"], "Pixel 8 Pro 128GB Unlocked");
    expect(hardIds(tags)).toEqual(
      expect.arrayContaining(["imei_verification", "google_frp_lock", "financing_paid_off"]),
    );
    expect(hardIds(tags)).not.toContain("samsung_reactivation_lock");
    expect(hardIds(tags)).not.toContain("find_my_status");
  });

  it("Google Pixel title still classifies via google-pixel", () => {
    const { tags } = enrichTagsWithTaxonomy(["electronics"], "Google Pixel 8 Pro");
    expect(hardIds(tags)).toContain("google_frp_lock");
    expect(hardIds(tags)).toContain("imei_verification");
  });

  it("shoes title does NOT classify to sneakers HARD / unansweredHard sneaker authenticity", () => {
    const inferred = inferTaxonomyTags("Nike Air Force 1 shoes size 10");
    expect(inferred).not.toEqual(expect.arrayContaining(["shoes"]));
    const { tags } = enrichTagsWithTaxonomy(["clothing"], "Nike Air Force 1 shoes size 10");
    expect(hardIds(tags)).not.toContain("sneaker_authenticity");
    expect(hardIds(["clothing", "shoes"])).not.toContain("sneaker_authenticity");
    expect(hardIds(["shoes"])).not.toContain("sneaker_authenticity");
    const unanswered = unansweredHardCriteria(["clothing", "shoes"], []).map((c) => c.checkId);
    expect(unanswered).not.toContain("sneaker_authenticity");
    // clothing-level authenticity may still apply via the clothing tag, but the A10
    // shoes→sneakers authenticity HARD path must stay closed.
    expect(unansweredHardCriteria(["shoes"], []).map((c) => c.checkId)).not.toContain(
      "sneaker_authenticity",
    );
    expect(unansweredHardCriteria(["shoes"], []).map((c) => c.checkId)).not.toContain(
      "authenticity",
    );
  });

  it("dead-pixel monitor tags do NOT open Pixel phone gates (ambiguous-token hardening)", () => {
    expect(hardIds(["electronics", "monitor", "no-dead-pixel"])).not.toContain("imei_verification");
    expect(hardIds(["electronics", "dead-pixel"])).not.toContain("google_frp_lock");
    // Real Pixel model tags still open the phone node.
    expect(hardIds(["electronics", "pixel-8-pro"])).toEqual(
      expect.arrayContaining(["imei_verification", "google_frp_lock"]),
    );
  });
});

describe("A10/D3 gate — reject / pass for galaxy / pixel HARD criteria (no shoes)", () => {
  const cases: Array<{ name: string; tags: string[]; signatureHard: string[] }> = [
    {
      name: "galaxy",
      tags: ["electronics", "samsung-galaxy-s24"],
      signatureHard: ["imei_verification", "google_frp_lock", "samsung_reactivation_lock"],
    },
    {
      name: "pixel",
      tags: ["electronics", "pixel-8-pro"],
      signatureHard: ["imei_verification", "google_frp_lock"],
    },
  ];

  for (const { name, tags, signatureHard } of cases) {
    it(`${name}: reject — unanswered HARD criteria listed when stance missing`, () => {
      const missing = unansweredHardCriteria(tags, []);
      const ids = missing.map((c) => c.checkId);
      for (const gate of signatureHard) {
        expect(ids, `${name} should require ${gate}`).toContain(gate);
      }
      expect(missing.every((c) => c.enforcement === "hard")).toBe(true);
      expect(missing.every((c) => c.requirement === "required")).toBe(true);
    });

    it(`${name}: pass — unanswered HARD empty once every HARD has stance`, () => {
      const allHard = hardIds(tags);
      expect(allHard.length).toBeGreaterThan(0);
      const criteria = allHard.map((id) => answered(id));
      expect(unansweredHardCriteria(tags, criteria)).toEqual([]);
    });

    it(`${name}: reject — partial answers still surface remaining HARD`, () => {
      const [first, ...rest] = signatureHard;
      expect(first).toBeTruthy();
      const missing = unansweredHardCriteria(tags, [answered(first!)]);
      const ids = missing.map((c) => c.checkId);
      expect(ids).not.toContain(first);
      for (const gate of rest) {
        expect(ids).toContain(gate);
      }
    });
  }
});
