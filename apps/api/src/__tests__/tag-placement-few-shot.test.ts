/**
 * Unit tests for tag-placement few-shot pool + selector (Step 61).
 *
 * See handoff/ARCHITECT-BRIEF-step60-62.md §Step 61 test plan.
 */

import { describe, expect, it } from "vitest";

import {
  FEW_SHOT_POOL,
  selectFewShots,
  toChatMessages,
} from "../prompts/tag-placement/index.js";

describe("FEW_SHOT_POOL", () => {
  it("has exactly 8 entries", () => {
    expect(FEW_SHOT_POOL).toHaveLength(8);
  });

  it("every entry has a user+assistant pair whose assistant content parses as valid JSON with expected keys", () => {
    for (const example of FEW_SHOT_POOL) {
      expect(example.messages).toHaveLength(2);
      expect(example.messages[0].role).toBe("user");
      expect(example.messages[1].role).toBe("assistant");

      const parsed = JSON.parse(example.messages[1].content) as {
        selected_tag_ids: unknown;
        reasoning: unknown;
        missing_tags: unknown;
      };
      expect(Array.isArray(parsed.selected_tag_ids)).toBe(true);
      expect(typeof parsed.reasoning).toBe("string");
      expect(Array.isArray(parsed.missing_tags)).toBe(true);
    }
  });
});

describe("selectFewShots", () => {
  it("returns ≥ 2 electronics examples for a consumer electronics phone category", () => {
    const selected = selectFewShots("consumer electronics / phones / iphone");
    const electronicsCount = selected.filter(
      (e) => e.category === "electronics",
    ).length;
    expect(selected.length).toBeGreaterThanOrEqual(2);
    expect(electronicsCount).toBeGreaterThanOrEqual(2);
  });

  it("returns ≥ 2 fashion examples for a women's fashion jackets category", () => {
    const selected = selectFewShots("women's fashion / jackets");
    const fashionCount = selected.filter(
      (e) => e.category === "fashion",
    ).length;
    expect(selected.length).toBeGreaterThanOrEqual(2);
    expect(fashionCount).toBeGreaterThanOrEqual(2);
  });

  it("returns ≥ 2 gaming examples for a gaming console category", () => {
    const selected = selectFewShots("gaming / console");
    const gamingCount = selected.filter((e) => e.category === "gaming").length;
    expect(selected.length).toBeGreaterThanOrEqual(2);
    expect(gamingCount).toBeGreaterThanOrEqual(2);
  });

  it("returns 2-3 examples for null category (fallback path)", () => {
    const selected = selectFewShots(null);
    expect(selected.length).toBeGreaterThanOrEqual(2);
    expect(selected.length).toBeLessThanOrEqual(3);
  });

  it("returns 2-3 examples for an unknown category (0 matches → generics-or-fallback)", () => {
    const selected = selectFewShots("unknown widget");
    expect(selected.length).toBeGreaterThanOrEqual(2);
    expect(selected.length).toBeLessThanOrEqual(3);
  });

  it("is deterministic: same input twice yields referentially identical entries", () => {
    const a = selectFewShots("consumer electronics / phones / iphone");
    const b = selectFewShots("consumer electronics / phones / iphone");
    expect(a).toHaveLength(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
    }
  });
});

describe("toChatMessages", () => {
  it("flattens N examples into 2N messages preserving order", () => {
    const selected = selectFewShots("consumer electronics / phones / iphone");
    const flat = toChatMessages(selected);

    expect(flat).toHaveLength(selected.length * 2);

    for (let i = 0; i < selected.length; i++) {
      expect(flat[i * 2]).toEqual({
        role: "user",
        content: selected[i].messages[0].content,
      });
      expect(flat[i * 2 + 1]).toEqual({
        role: "assistant",
        content: selected[i].messages[1].content,
      });
    }
  });
});
