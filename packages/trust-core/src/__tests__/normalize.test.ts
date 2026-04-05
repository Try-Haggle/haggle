import { describe, it, expect } from "vitest";
import {
  normalizeRate,
  normalizeInverseRate,
  normalizeFrequency,
  normalizeAge,
  normalizeRating,
  normalizeInput,
  FREQUENCY_CAP,
  AGE_CAP_DAYS,
  RATING_MAX,
} from "../normalize.js";

describe("normalize", () => {
  describe("normalizeRate", () => {
    it("should pass through values in [0, 1]", () => {
      expect(normalizeRate(0)).toBe(0);
      expect(normalizeRate(0.5)).toBe(0.5);
      expect(normalizeRate(1)).toBe(1);
    });

    it("should clamp values above 1", () => {
      expect(normalizeRate(1.5)).toBe(1);
    });

    it("should clamp values below 0", () => {
      expect(normalizeRate(-0.1)).toBe(0);
    });
  });

  describe("normalizeInverseRate", () => {
    it("should invert rate: 0 -> 1, 1 -> 0", () => {
      expect(normalizeInverseRate(0)).toBe(1);
      expect(normalizeInverseRate(1)).toBe(0);
    });

    it("should invert 0.3 -> 0.7", () => {
      expect(normalizeInverseRate(0.3)).toBeCloseTo(0.7, 10);
    });

    it("should clamp result for values > 1", () => {
      expect(normalizeInverseRate(1.5)).toBe(0);
    });

    it("should clamp result for values < 0", () => {
      expect(normalizeInverseRate(-0.5)).toBe(1);
    });
  });

  describe("normalizeFrequency", () => {
    it("should return 0 for 0 transactions", () => {
      expect(normalizeFrequency(0)).toBe(0);
    });

    it("should return 0.5 for 50 transactions", () => {
      expect(normalizeFrequency(50)).toBe(0.5);
    });

    it("should cap at 1 for >= 100 transactions", () => {
      expect(normalizeFrequency(100)).toBe(1);
      expect(normalizeFrequency(200)).toBe(1);
    });

    it("should return 0 for negative values", () => {
      expect(normalizeFrequency(-10)).toBe(0);
    });

    it("should use FREQUENCY_CAP of 100", () => {
      expect(FREQUENCY_CAP).toBe(100);
    });
  });

  describe("normalizeAge", () => {
    it("should return 0 for 0 days", () => {
      expect(normalizeAge(0)).toBe(0);
    });

    it("should return 0.5 for ~182 days", () => {
      expect(normalizeAge(182.5)).toBeCloseTo(0.5, 2);
    });

    it("should cap at 1 for >= 365 days", () => {
      expect(normalizeAge(365)).toBe(1);
      expect(normalizeAge(730)).toBe(1);
    });

    it("should return 0 for negative values", () => {
      expect(normalizeAge(-30)).toBe(0);
    });

    it("should use AGE_CAP_DAYS of 365", () => {
      expect(AGE_CAP_DAYS).toBe(365);
    });
  });

  describe("normalizeRating", () => {
    it("should return 0 for 0 rating", () => {
      expect(normalizeRating(0)).toBe(0);
    });

    it("should return 1 for 5-star rating", () => {
      expect(normalizeRating(5)).toBe(1);
    });

    it("should return 0.8 for 4-star rating", () => {
      expect(normalizeRating(4)).toBeCloseTo(0.8, 10);
    });

    it("should clamp above 5", () => {
      expect(normalizeRating(6)).toBe(1);
    });

    it("should return 0 for negative rating", () => {
      expect(normalizeRating(-1)).toBe(0);
    });

    it("should use RATING_MAX of 5", () => {
      expect(RATING_MAX).toBe(5);
    });
  });

  describe("normalizeInput (unified)", () => {
    it("should dispatch to normalizeRate for 'rate' type", () => {
      expect(normalizeInput(0.75, "rate")).toBe(0.75);
    });

    it("should dispatch to normalizeInverseRate for 'inverse_rate' type", () => {
      expect(normalizeInput(0.1, "inverse_rate")).toBeCloseTo(0.9, 10);
    });

    it("should dispatch to normalizeFrequency for 'frequency' type", () => {
      expect(normalizeInput(50, "frequency")).toBe(0.5);
    });

    it("should dispatch to normalizeAge for 'age' type", () => {
      expect(normalizeInput(365, "age")).toBe(1);
    });

    it("should dispatch to normalizeRating for 'rating' type", () => {
      expect(normalizeInput(4, "rating")).toBeCloseTo(0.8, 10);
    });
  });
});
