/**
 * Step 62 Part B — embedding builders + registry unit tests.
 */

import { describe, expect, it } from "vitest";

import {
  buildDefaultEmbeddingInput,
  buildElectronicsEmbeddingInput,
  buildFashionEmbeddingInput,
  resolveEmbeddingBuilder,
} from "../prompts/embedding/index.js";

describe("buildDefaultEmbeddingInput", () => {
  it("returns empty string for empty snapshot", () => {
    expect(buildDefaultEmbeddingInput({})).toBe("");
  });

  it("regression: full snapshot produces expected tagged output", () => {
    const snapshot = {
      title: "Vintage Leather Jacket",
      category: "Fashion / Jackets",
      condition: "Used - Good",
      tags: ["leather", "vintage", "brown"],
      description: "Well-kept vintage brown leather jacket.",
      targetPrice: 150,
    };
    const expected = [
      "[TITLE] Vintage Leather Jacket",
      "[CATEGORY] Fashion / Jackets",
      "[CONDITION] Used - Good",
      "[TAGS] leather, vintage, brown",
      "[DESCRIPTION] Well-kept vintage brown leather jacket.",
      "[PRICE_BAND] $100-$250",
    ].join("\n");
    expect(buildDefaultEmbeddingInput(snapshot)).toBe(expected);
  });

  it("omits [PRICE_BAND] line when targetPrice is missing", () => {
    const out = buildDefaultEmbeddingInput({
      title: "No price item",
      category: "Misc",
    });
    expect(out).not.toContain("[PRICE_BAND]");
    expect(out).toContain("[TITLE] No price item");
  });
});

describe("buildElectronicsEmbeddingInput", () => {
  it("full iPhone snapshot emits all bracketed fields in order", () => {
    const snapshot = {
      title: "iPhone 15 Pro 256GB Natural Titanium",
      category: "Consumer Electronics / Phones / iPhone",
      brand: "Apple",
      model: "iPhone 15 Pro",
      storage: "256GB",
      carrier: "Unlocked",
      batteryHealth: "98%",
      condition: "Like New",
      tags: ["apple", "iphone", "titanium"],
      description: "Excellent condition, original box.",
      targetPrice: 850,
    };
    const out = buildElectronicsEmbeddingInput(snapshot);
    const lines = out.split("\n");
    expect(lines).toEqual([
      "[TITLE] iPhone 15 Pro 256GB Natural Titanium",
      "[CATEGORY] Consumer Electronics / Phones / iPhone",
      "[BRAND] Apple",
      "[MODEL] iPhone 15 Pro",
      "[STORAGE] 256GB",
      "[CARRIER] Unlocked",
      "[BATTERY_HEALTH] 98%",
      "[CONDITION] Like New",
      "[TAGS] apple, iphone, titanium",
      "[DESCRIPTION] Excellent condition, original box.",
      "[PRICE_BAND] $500-$1000",
    ]);
  });

  it("falls back to tag inspection for storage when snapshot.storage is missing", () => {
    const out = buildElectronicsEmbeddingInput({
      title: "iPhone 14",
      category: "Phones",
      tags: ["apple", "256gb", "unlocked"],
    });
    expect(out).toContain("[STORAGE] 256gb");
    // Carrier falls back to "unlocked" tag too.
    expect(out).toContain("[CARRIER] unlocked");
  });

  it("gracefully degrades when all optional fields are missing", () => {
    const out = buildElectronicsEmbeddingInput({
      title: "Mystery gadget",
      category: "Electronics",
      tags: ["gadget"],
      description: "A thing.",
      targetPrice: 25,
    });
    const lines = out.split("\n");
    expect(lines).toEqual([
      "[TITLE] Mystery gadget",
      "[CATEGORY] Electronics",
      "[TAGS] gadget",
      "[DESCRIPTION] A thing.",
      "[PRICE_BAND] $0-$50",
    ]);
    expect(out).not.toContain("[BRAND]");
    expect(out).not.toContain("[MODEL]");
    expect(out).not.toContain("[STORAGE]");
    expect(out).not.toContain("[CARRIER]");
    expect(out).not.toContain("[BATTERY_HEALTH]");
    expect(out).not.toContain("[CONDITION]");
  });
});

describe("buildFashionEmbeddingInput", () => {
  it("full fashion snapshot emits all bracketed fields in order", () => {
    const snapshot = {
      title: "Nike Air Jordan 1 High",
      category: "Fashion / Shoes / Sneakers",
      brand: "Nike",
      size: "10",
      color: "Chicago Red",
      material: "Leather",
      condition: "New",
      tags: ["nike", "jordan", "sneakers"],
      description: "Brand new, never worn.",
      targetPrice: 300,
    };
    const out = buildFashionEmbeddingInput(snapshot);
    expect(out.split("\n")).toEqual([
      "[TITLE] Nike Air Jordan 1 High",
      "[CATEGORY] Fashion / Shoes / Sneakers",
      "[BRAND] Nike",
      "[SIZE] 10",
      "[COLOR] Chicago Red",
      "[MATERIAL] Leather",
      "[CONDITION] New",
      "[TAGS] nike, jordan, sneakers",
      "[DESCRIPTION] Brand new, never worn.",
      "[PRICE_BAND] $250-$500",
    ]);
  });

  it("minimal fashion snapshot emits only title + category", () => {
    const out = buildFashionEmbeddingInput({
      title: "Plain tee",
      category: "Apparel",
    });
    expect(out).toBe("[TITLE] Plain tee\n[CATEGORY] Apparel");
  });
});

describe("resolveEmbeddingBuilder", () => {
  it("returns electronics builder for phone category", () => {
    const builder = resolveEmbeddingBuilder({
      category: "Consumer Electronics / Phones",
    });
    // Sentinel: only the electronics builder emits [STORAGE] from snapshot.storage.
    const out = builder({
      title: "t",
      category: "Consumer Electronics / Phones",
      storage: "128GB",
    });
    expect(out).toContain("[STORAGE] 128GB");
  });

  it("returns fashion builder for jacket category", () => {
    const builder = resolveEmbeddingBuilder({
      category: "Women's Fashion / Jackets",
    });
    // Sentinel: only the fashion builder emits [SIZE] from snapshot.size.
    const out = builder({
      title: "t",
      category: "Women's Fashion / Jackets",
      size: "M",
    });
    expect(out).toContain("[SIZE] M");
  });

  it("returns default builder for unrelated category", () => {
    const builder = resolveEmbeddingBuilder({ category: "Books" });
    // Sentinel: default builder IGNORES `storage` field entirely.
    const out = builder({
      title: "t",
      category: "Books",
      storage: "128GB",
    });
    expect(out).not.toContain("[STORAGE]");
  });

  it("returns default builder when category is absent", () => {
    const builder = resolveEmbeddingBuilder({});
    const out = builder({
      title: "t",
      storage: "128GB",
      size: "M",
    });
    expect(out).not.toContain("[STORAGE]");
    expect(out).not.toContain("[SIZE]");
    expect(out).toBe("[TITLE] t");
  });
});
