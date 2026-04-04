import { describe, it, expect } from "vitest";
import {
  classifyAmountTier,
  getColdStartHours,
  resolveSegment,
  resolveReviewHours,
} from "../segments.js";
import type { SegmentData } from "../types.js";

// ---------------------------------------------------------------------------
// classifyAmountTier
// ---------------------------------------------------------------------------

describe("classifyAmountTier", () => {
  it("classifies $10 as MICRO", () => {
    expect(classifyAmountTier(1_000)).toBe("MICRO");
  });

  it("classifies $50 as MICRO (upper bound)", () => {
    expect(classifyAmountTier(5_000)).toBe("MICRO");
  });

  it("classifies $51 as LOW", () => {
    expect(classifyAmountTier(5_001)).toBe("LOW");
  });

  it("classifies $200 as LOW", () => {
    expect(classifyAmountTier(20_000)).toBe("LOW");
  });

  it("classifies $201 as MID", () => {
    expect(classifyAmountTier(20_001)).toBe("MID");
  });

  it("classifies $1,001 as HIGH", () => {
    expect(classifyAmountTier(100_001)).toBe("HIGH");
  });

  it("classifies $5,001 as PREMIUM", () => {
    expect(classifyAmountTier(500_001)).toBe("PREMIUM");
  });

  it("classifies $50,001 as ULTRA", () => {
    expect(classifyAmountTier(5_000_001)).toBe("ULTRA");
  });

  it("below minimum falls to MICRO", () => {
    expect(classifyAmountTier(500)).toBe("MICRO");
  });

  it("very large amount is ULTRA", () => {
    expect(classifyAmountTier(100_000_000)).toBe("ULTRA");
  });
});

// ---------------------------------------------------------------------------
// getColdStartHours
// ---------------------------------------------------------------------------

describe("getColdStartHours", () => {
  it("CLOTHING + MICRO = max(24, 24) = 24h", () => {
    expect(getColdStartHours("CLOTHING", "MICRO")).toBe(24);
  });

  it("ELECTRONICS_LARGE + HIGH = max(72, 72) = 72h", () => {
    expect(getColdStartHours("ELECTRONICS_LARGE", "HIGH")).toBe(72);
  });

  it("REAL_ESTATE + ULTRA = max(336, 168) = 336h", () => {
    expect(getColdStartHours("REAL_ESTATE", "ULTRA")).toBe(336);
  });

  it("BOOKS_MEDIA + PREMIUM = max(24, 120) = 120h (amount wins)", () => {
    expect(getColdStartHours("BOOKS_MEDIA", "PREMIUM")).toBe(120);
  });

  it("VEHICLES + MICRO = max(168, 24) = 168h (category wins)", () => {
    expect(getColdStartHours("VEHICLES", "MICRO")).toBe(168);
  });

  it("OTHER + LOW = max(36, 36) = 36h", () => {
    expect(getColdStartHours("OTHER", "LOW")).toBe(36);
  });
});

// ---------------------------------------------------------------------------
// resolveSegment
// ---------------------------------------------------------------------------

describe("resolveSegment", () => {
  const segments: SegmentData[] = [
    { key: { category: "ELECTRONICS_SMALL", amount_tier: "MID" }, review_hours: 60, sample_count: 50 },
    { key: { category: "ELECTRONICS_SMALL" }, review_hours: 52, sample_count: 100 },
    { key: { amount_tier: "MID" }, review_hours: 48, sample_count: 80 },
    { key: { category: "CLOTHING", amount_tier: "LOW" }, review_hours: 30, sample_count: 10 }, // < 30 sample
  ];

  it("finds exact match", () => {
    const seg = resolveSegment({ category: "ELECTRONICS_SMALL", amount_tier: "MID" }, segments);
    expect(seg).not.toBeNull();
    expect(seg!.review_hours).toBe(60);
  });

  it("returns null if no match", () => {
    const seg = resolveSegment({ category: "JEWELRY", amount_tier: "HIGH" }, segments);
    expect(seg).toBeNull();
  });

  it("returns null if sample count below min", () => {
    const seg = resolveSegment({ category: "CLOTHING", amount_tier: "LOW" }, segments);
    expect(seg).toBeNull();
  });

  it("matches category-only segment", () => {
    const seg = resolveSegment({ category: "ELECTRONICS_SMALL" }, segments);
    expect(seg).not.toBeNull();
    expect(seg!.review_hours).toBe(52);
  });
});

// ---------------------------------------------------------------------------
// resolveReviewHours
// ---------------------------------------------------------------------------

describe("resolveReviewHours", () => {
  it("falls back to cold-start when no segments", () => {
    const hours = resolveReviewHours("ELECTRONICS_LARGE", "HIGH", [], []);
    // max(72, 72) = 72
    expect(hours).toBe(72);
  });

  it("uses category × amount segment when available", () => {
    const segments: SegmentData[] = [
      { key: { category: "CLOTHING", amount_tier: "LOW" }, review_hours: 30, sample_count: 50 },
    ];
    expect(resolveReviewHours("CLOTHING", "LOW", [], segments)).toBe(30);
  });

  it("uses category-only fallback", () => {
    const segments: SegmentData[] = [
      { key: { category: "JEWELRY" }, review_hours: 80, sample_count: 40 },
    ];
    expect(resolveReviewHours("JEWELRY", "MID", [], segments)).toBe(80);
  });

  it("uses amount-only fallback", () => {
    const segments: SegmentData[] = [
      { key: { amount_tier: "PREMIUM" }, review_hours: 110, sample_count: 35 },
    ];
    expect(resolveReviewHours("OTHER", "PREMIUM", [], segments)).toBe(110);
  });

  it("applies Math.max across tag and non-tag segments", () => {
    const segments: SegmentData[] = [
      { key: { category: "ELECTRONICS_SMALL", amount_tier: "MID" }, review_hours: 50, sample_count: 60 },
      { key: { tag: "refurbished", amount_tier: "MID" }, review_hours: 72, sample_count: 40 },
    ];
    // category×amount = 50, tag×amount = 72 → max = 72
    expect(resolveReviewHours("ELECTRONICS_SMALL", "MID", ["refurbished"], segments)).toBe(72);
  });

  it("ignores segments below min sample count", () => {
    const segments: SegmentData[] = [
      { key: { category: "ART", amount_tier: "HIGH" }, review_hours: 100, sample_count: 5 },
    ];
    // sample < 30, falls through to cold-start: max(72, 72) = 72
    expect(resolveReviewHours("ART", "HIGH", [], segments)).toBe(72);
  });

  it("tag segment alone used as fallback", () => {
    const segments: SegmentData[] = [
      { key: { tag: "vintage" }, review_hours: 96, sample_count: 50 },
    ];
    // tag alone = 96, no category/amount segment → cold-start max(48, 48)=48
    // Math.max(96, 48) = 96
    expect(resolveReviewHours("COLLECTIBLES", "MID", ["vintage"], segments)).toBe(96);
  });
});
