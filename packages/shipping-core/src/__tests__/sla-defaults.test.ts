import { describe, it, expect } from "vitest";
import { getDefaultSlaDays, getMinimumSlaDays } from "../sla-defaults.js";

describe("getDefaultSlaDays", () => {
  it("returns correct defaults for major categories", () => {
    expect(getDefaultSlaDays("BOOKS_MEDIA")).toBe(3);
    expect(getDefaultSlaDays("ELECTRONICS_LARGE")).toBe(5);
    expect(getDefaultSlaDays("VEHICLES")).toBe(10);
    expect(getDefaultSlaDays("REAL_ESTATE")).toBe(14);
    expect(getDefaultSlaDays("ART")).toBe(7);
  });

  it("returns 5 for unknown category", () => {
    expect(getDefaultSlaDays("UNKNOWN_THING")).toBe(5);
    expect(getDefaultSlaDays("")).toBe(5);
  });
});

describe("getMinimumSlaDays", () => {
  it("returns correct minimums for categories", () => {
    expect(getMinimumSlaDays("BOOKS_MEDIA")).toBe(1);
    expect(getMinimumSlaDays("ELECTRONICS_LARGE")).toBe(2);
    expect(getMinimumSlaDays("VEHICLES")).toBe(5);
    expect(getMinimumSlaDays("REAL_ESTATE")).toBe(7);
    expect(getMinimumSlaDays("HEAVY_EQUIPMENT")).toBe(5);
  });

  it("returns 1 for unknown category", () => {
    expect(getMinimumSlaDays("UNKNOWN")).toBe(1);
  });

  it("minimum is always <= default for every known category", () => {
    const categories = [
      "BOOKS_MEDIA", "CLOTHING", "ELECTRONICS_SMALL", "ELECTRONICS_LARGE",
      "COLLECTIBLES", "LUXURY_FASHION", "JEWELRY", "SPORTS_OUTDOOR",
      "HOME_GARDEN", "VEHICLES", "VEHICLE_PARTS", "REAL_ESTATE",
      "HEAVY_EQUIPMENT", "MUSICAL_INSTRUMENTS", "ART", "OTHER",
    ];
    for (const cat of categories) {
      expect(getMinimumSlaDays(cat)).toBeLessThanOrEqual(getDefaultSlaDays(cat));
    }
  });
});
