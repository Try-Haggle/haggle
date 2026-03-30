import { describe, it, expect } from "vitest";
import {
  mapToLegitCategory,
  isFallbackCategory,
  FALLBACK_CATEGORIES,
  type HaggleCategory,
} from "../category-map.js";

describe("category-map", () => {
  describe("mapToLegitCategory", () => {
    it.each<[HaggleCategory, string]>([
      ["sneakers", "sneakers"],
      ["streetwear", "streetwear"],
      ["handbags", "handbags"],
      ["watches", "watches"],
      ["jewelry", "jewelry"],
      ["collectibles", "collectibles"],
      ["accessories", "accessories"],
    ])("maps %s → %s (direct)", (haggle, legit) => {
      expect(mapToLegitCategory(haggle)).toBe(legit);
    });

    it.each<[HaggleCategory, string]>([
      ["electronics", "accessories"],
      ["automotive", "accessories"],
    ])("maps %s → %s (fallback)", (haggle, legit) => {
      expect(mapToLegitCategory(haggle)).toBe(legit);
    });
  });

  describe("isFallbackCategory", () => {
    it("returns true for electronics", () => {
      expect(isFallbackCategory("electronics")).toBe(true);
    });

    it("returns true for automotive", () => {
      expect(isFallbackCategory("automotive")).toBe(true);
    });

    it("returns false for sneakers", () => {
      expect(isFallbackCategory("sneakers")).toBe(false);
    });

    it("returns false for handbags", () => {
      expect(isFallbackCategory("handbags")).toBe(false);
    });
  });

  describe("FALLBACK_CATEGORIES", () => {
    it("contains exactly electronics and automotive", () => {
      expect(FALLBACK_CATEGORIES).toEqual(["electronics", "automotive"]);
    });
  });
});
