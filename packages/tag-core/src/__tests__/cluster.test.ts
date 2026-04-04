import { describe, it, expect } from "vitest";
import {
  levenshtein,
  findSynonymCanonical,
  areSynonyms,
  findSimilarTags,
  suggestMerges,
} from "../cluster.js";
import type { Tag } from "../types.js";
import { defaultTagConfig } from "../types.js";

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: "tag-1",
    name: "Electronics",
    normalizedName: "electronics",
    status: "OFFICIAL",
    category: "ELECTRONICS_SMALL",
    useCount: 20,
    createdAt: "2026-01-01T00:00:00Z",
    lastUsedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("returns length for empty vs non-empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("returns 0 for two empty strings", () => {
    expect(levenshtein("", "")).toBe(0);
  });

  it("computes single substitution", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  it("computes single insertion", () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });

  it("computes single deletion", () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  it("computes complex distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("is symmetric", () => {
    expect(levenshtein("abc", "xyz")).toBe(levenshtein("xyz", "abc"));
  });
});

describe("findSynonymCanonical", () => {
  const synonymMap = {
    phone: ["mobile", "cellphone", "smartphone"],
    laptop: ["notebook", "portable"],
  };

  it("finds canonical for synonym", () => {
    expect(findSynonymCanonical("mobile", synonymMap)).toBe("phone");
  });

  it("finds canonical for canonical key itself", () => {
    expect(findSynonymCanonical("phone", synonymMap)).toBe("phone");
  });

  it("returns undefined for unknown term", () => {
    expect(findSynonymCanonical("tablet", synonymMap)).toBeUndefined();
  });
});

describe("areSynonyms", () => {
  const synonymMap = {
    phone: ["mobile", "cellphone"],
  };

  it("detects synonyms", () => {
    expect(areSynonyms("mobile", "cellphone", synonymMap)).toBe(true);
  });

  it("detects synonym with canonical", () => {
    expect(areSynonyms("phone", "mobile", synonymMap)).toBe(true);
  });

  it("rejects non-synonyms", () => {
    expect(areSynonyms("phone", "laptop", synonymMap)).toBe(false);
  });
});

describe("findSimilarTags", () => {
  it("finds tags within Levenshtein threshold", () => {
    const target = makeTag({ id: "t1", normalizedName: "phone" });
    const pool = [
      makeTag({ id: "t2", normalizedName: "phon" }),
      makeTag({ id: "t3", normalizedName: "phones" }),
      makeTag({ id: "t4", normalizedName: "laptop" }),
    ];
    const cluster = findSimilarTags(target, pool);
    expect(cluster.similar).toHaveLength(2);
    expect(cluster.distances).toEqual([1, 1]);
  });

  it("excludes the target tag from results", () => {
    const target = makeTag({ id: "t1", normalizedName: "phone" });
    const pool = [target];
    const cluster = findSimilarTags(target, pool);
    expect(cluster.similar).toHaveLength(0);
  });

  it("respects custom threshold", () => {
    const config = { ...defaultTagConfig(), levenshteinThreshold: 1 };
    const target = makeTag({ id: "t1", normalizedName: "phone" });
    const pool = [
      makeTag({ id: "t2", normalizedName: "phon" }), // dist 1 - included
      makeTag({ id: "t3", normalizedName: "pho" }), // dist 2 - excluded
    ];
    const cluster = findSimilarTags(target, pool, config);
    expect(cluster.similar).toHaveLength(1);
  });
});

describe("suggestMerges", () => {
  it("suggests merge for similar tags (Levenshtein)", () => {
    const tags = [
      makeTag({ id: "t1", normalizedName: "phone", useCount: 30 }),
      makeTag({ id: "t2", normalizedName: "phones", useCount: 10 }),
    ];
    const suggestions = suggestMerges(tags);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].reason).toBe("levenshtein");
    expect(suggestions[0].target.id).toBe("t1"); // higher useCount
    expect(suggestions[0].source.id).toBe("t2");
  });

  it("suggests merge for synonym matches", () => {
    const config = {
      ...defaultTagConfig(),
      levenshteinThreshold: 0, // disable Levenshtein
      synonymMap: { phone: ["mobile"] },
    };
    const tags = [
      makeTag({ id: "t1", normalizedName: "phone", useCount: 50 }),
      makeTag({ id: "t2", normalizedName: "mobile", useCount: 5 }),
    ];
    const suggestions = suggestMerges(tags, config);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].reason).toBe("synonym");
  });

  it("does not duplicate suggestions", () => {
    const tags = [
      makeTag({ id: "t1", normalizedName: "phone", useCount: 10 }),
      makeTag({ id: "t2", normalizedName: "phon", useCount: 5 }),
    ];
    const suggestions = suggestMerges(tags);
    expect(suggestions).toHaveLength(1);
  });

  it("returns empty for no similar tags", () => {
    const tags = [
      makeTag({ id: "t1", normalizedName: "electronics" }),
      makeTag({ id: "t2", normalizedName: "clothing" }),
    ];
    const suggestions = suggestMerges(tags);
    expect(suggestions).toHaveLength(0);
  });
});
