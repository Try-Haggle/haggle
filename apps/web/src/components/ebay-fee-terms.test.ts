import { describe, expect, it } from "vitest";
import { EBAY_CONDITIONS_TEXT, EBAY_FEE_TERMS, ebayFeeEstimate } from "./ebay-fee-terms";

describe("ebayFeeEstimate", () => {
  it("applies the $0.30 fixed fee at or below $10", () => {
    expect(ebayFeeEstimate(10)).toBeCloseTo(1.66, 2);
  });
  it("applies the $0.40 fixed fee above $10", () => {
    expect(ebayFeeEstimate(500)).toBeCloseTo(68.4, 2);
  });
  it("applies the over-cap rate only to the part above $7,500", () => {
    expect(ebayFeeEstimate(10000)).toBeCloseTo(0.136 * 7500 + 0.0235 * 2500 + 0.4, 2);
  });
  it("returns 0 for non-positive prices and pins the version", () => {
    expect(ebayFeeEstimate(0)).toBe(0);
    expect(EBAY_FEE_TERMS.version).toBe("ebay-us-nostore-2026-10-02-v1");
  });
});

import { describeFeeDifference, isEbayComparable } from "./ebay-fee-terms";

describe("amount boundaries", () => {
  it("matches CLO check values across $10 and $7,500", () => {
    expect(ebayFeeEstimate(10)).toBeCloseTo(1.66, 2);
    expect(ebayFeeEstimate(10.01)).toBeCloseTo(1.76, 2);
    expect(ebayFeeEstimate(7500)).toBeCloseTo(1020.4, 2);
    expect(ebayFeeEstimate(8000)).toBeCloseTo(1032.15, 2);
  });
});

describe("category gate", () => {
  it("allows only verified general-rate categories", () => {
    expect(isEbayComparable("electronics")).toBe(true);
    for (const c of ["sneakers", "general", "fashion", "collectibles", "books", "", "unknown"]) {
      expect(isEbayComparable(c)).toBe(false);
    }
  });
});

describe("describeFeeDifference", () => {
  it("never labels zero or negative as lower", () => {
    expect(describeFeeDifference(12.345).label).toBe("~$12.35 lower fees than eBay est.");
    expect(describeFeeDifference(0).label).toBe("no difference");
    expect(describeFeeDifference(0.004).label).toBe("no difference");
    expect(describeFeeDifference(-3).label).toBe("~$3.00 higher fees than eBay est.");
  });
});

describe("conditions text", () => {
  it("renders rates without floating-point noise", () => {
    expect(EBAY_CONDITIONS_TEXT).toContain("13.6% up to");
    expect(EBAY_CONDITIONS_TEXT).toContain("2.35% above");
    expect(EBAY_CONDITIONS_TEXT).not.toMatch(/\d\.\d{6,}/);
  });
});
