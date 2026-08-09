/**
 * ② Learned-check dedup: a reworded copy of a check we ALREADY ask must never be
 * recorded as a new one.
 *
 * Found in real e2e. The taxonomy's `lien_status.buyerAskKo` is
 *   "Should the agent require the vehicle be free & clear of any loan/lien?"
 * and the model asked
 *   "Should the agent require the vehicle be free and clear of any loan or lien?"
 * Exact string matching saw two different questions, so the lien gate was on its way to
 * being learned a second time. Once promoted, the buyer would answer it twice: once from
 * the taxonomy, once from the overlay.
 */

import { describe, expect, it } from "vitest";
import {
  LEARNING_DUPLICATE_SIMILARITY,
  learningReadScopes,
  learningWriteScopes,
  observationCheckKey,
  questionSimilarity,
  questionTokens,
  TAG_SCOPE_PREFIX,
} from "../services/category-check-learning.service.js";

const TAXONOMY_LIEN_ASK = "Should the agent require the vehicle be free & clear of any loan/lien?";
const MODEL_LIEN_ASK =
  "Should the agent require the vehicle be free and clear of any loan or lien?";

const similar = (a: string, b: string) => questionSimilarity(questionTokens(a), questionTokens(b));

describe("questionTokens", () => {
  it("strips the shared 'Should the agent require ...' framing", () => {
    // What's left is only what distinguishes one check from another.
    expect(questionTokens(TAXONOMY_LIEN_ASK)).toEqual(["clear", "free", "lien", "loan", "vehicle"]);
  });

  it("collapses &/slash/word separators to the same tokens", () => {
    expect(questionTokens(MODEL_LIEN_ASK)).toEqual(questionTokens(TAXONOMY_LIEN_ASK));
  });

  it("returns nothing for a question made only of framing words", () => {
    expect(questionTokens("Should you? What about it?")).toEqual([]);
    expect(questionTokens("???")).toEqual([]);
  });

  it("keeps Korean content words", () => {
    expect(questionTokens("정품 충전기가 있나요?")).toContain("충전기가");
  });
});

describe("questionSimilarity", () => {
  it("scores the real e2e near-miss as a duplicate", () => {
    expect(similar(TAXONOMY_LIEN_ASK, MODEL_LIEN_ASK)).toBe(1);
  });

  it("scores a genuine reword of the same check above the threshold", () => {
    const score = similar(
      "Should the agent require a clean IMEI (not lost/blacklisted) before closing?",
      "Is the IMEI clean and not blacklisted?",
    );
    expect(score).toBeGreaterThanOrEqual(LEARNING_DUPLICATE_SIMILARITY);
  });

  it("keeps two different checks in the same category well apart", () => {
    // These share the word "damage" and nothing else; suppressing one would silently
    // drop a real gate.
    const score = similar("Any water damage?", "Any frame damage?");
    expect(score).toBeLessThan(LEARNING_DUPLICATE_SIMILARITY);
  });

  it("does not call a long-tail question a duplicate of an unrelated gate", () => {
    const score = similar(TAXONOMY_LIEN_ASK, "Is the original brass lens cap included?");
    expect(score).toBeLessThan(LEARNING_DUPLICATE_SIMILARITY);
  });

  it("is 0 when either side has no content words", () => {
    expect(questionSimilarity([], ["lien"])).toBe(0);
    expect(questionSimilarity(["lien"], [])).toBe(0);
  });
});

describe("observationCheckKey", () => {
  const key = (questionKo: string) =>
    observationCheckKey({ categoryPath: "vehicles", questionKo, sourceId: "listing-1" });

  it("pools two phrasings of one question into a single aggregate row", () => {
    // Otherwise each phrasing sits at one occurrence forever and never promotes.
    expect(key("What is its cosmetic condition?")).toBe(key("What's the cosmetic condition?"));
  });

  it("still separates questions that differ in substance", () => {
    expect(key("Any water damage?")).not.toBe(key("Any frame damage?"));
  });

  it("is unaffected by word order", () => {
    expect(key("Is the charger functional?")).toBe(key("Functional charger?"));
  });

  it("returns no key for a question with no content words", () => {
    expect(key("Should it?")).toBe("");
    expect(key("???")).toBe("");
  });

  it("still prefers an explicit checkId over the question form", () => {
    expect(
      observationCheckKey({
        categoryPath: "vehicles",
        checkId: "Lien_Status",
        questionKo: "anything",
        sourceId: "listing-1",
      }),
    ).toBe("lien_status");
  });
});

/**
 * ② Long-tail scoping. Learning used to be keyed strictly on taxonomy paths, so a
 * listing that resolved nothing — category "other", no modelled tags — was dropped at
 * the door. That excluded exactly the genuinely uncategorised items the flywheel exists
 * for: a brass telescope could be asked about forever and learn nothing.
 */
describe("learning scopes", () => {
  it("attributes a taxonomy hit to its most specific node only", () => {
    // An iPhone question must not be learned onto every electronics listing.
    expect(learningWriteScopes(["electronics", "iphone"])).toEqual(["electronics/phones/iphone"]);
  });

  it("falls back to tag scopes when nothing in the taxonomy matches", () => {
    expect(learningWriteScopes(["other", "brass-telescope"])).toEqual(["tag:brass-telescope"]);
  });

  it("namespaces tag scopes so they can never collide with a real path", () => {
    const [scope] = learningWriteScopes(["other", "telescope"]);
    expect(scope?.startsWith(TAG_SCOPE_PREFIX)).toBe(true);
    expect(scope).not.toBe("telescope");
  });

  it("drops generic buckets that identify nothing", () => {
    // Scoping to "other" would serve a telescope's questions on a ceramic vase.
    expect(learningWriteScopes(["other"])).toEqual([]);
    expect(learningWriteScopes(["misc", "unknown", "uncategorized"])).toEqual([]);
  });

  it("lets the taxonomy win over a tag that only looks generic", () => {
    // "기타" reads as "etc." in a category picker but the taxonomy claims it as a guitar
    // alias, so it must resolve `instruments` rather than being discarded as a bucket.
    expect(learningWriteScopes(["기타"])).toEqual(["instruments"]);
  });

  it("keeps every candidate tag instead of guessing which names the item", () => {
    expect(learningWriteScopes(["other", "vintage", "brass-telescope", "1900s"])).toEqual([
      "tag:vintage",
      "tag:brass-telescope",
      "tag:1900s",
    ]);
  });

  it("caps the fan-out so one listing cannot flood the table", () => {
    const scopes = learningWriteScopes(["other", "a", "b", "c", "d", "e"]);
    expect(scopes).toHaveLength(3);
  });

  it("is case- and duplicate-insensitive", () => {
    expect(learningWriteScopes(["other", "Brass-Telescope", "brass-telescope"])).toEqual([
      "tag:brass-telescope",
    ]);
  });

  it("reads every matched ancestor plus the listing's tag scopes", () => {
    // Write picks one scope; read must still find checks learned on an ancestor.
    const scopes = learningReadScopes(["electronics", "iphone"]);
    expect(scopes).toContain("electronics");
    expect(scopes).toContain("electronics/phones/iphone");
  });

  it("reads tag scopes for an unmatched listing so what was written comes back", () => {
    const tags = ["other", "brass-telescope"];
    for (const written of learningWriteScopes(tags)) {
      expect(learningReadScopes(tags)).toContain(written);
    }
  });
});
