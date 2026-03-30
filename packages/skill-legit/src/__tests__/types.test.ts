import { describe, it, expect } from "vitest";
import {
  isLegitAppCategory,
  isLegitAppTurnaround,
  isAuthVerdict,
  isAuthStatus,
  isAuthEventType,
  isLegitAppRawVerdict,
} from "../types.js";

describe("type guards", () => {
  describe("isLegitAppCategory", () => {
    it.each([
      "sneakers", "streetwear", "handbags", "watches", "jewelry",
      "accessories", "collectibles", "trading_cards", "wine_spirits",
      "art", "memorabilia",
    ])("returns true for valid category: %s", (cat) => {
      expect(isLegitAppCategory(cat)).toBe(true);
    });

    it.each([
      "invalid", "electronics", "SNEAKERS", "", 123, null, undefined,
    ])("returns false for invalid input: %s", (v) => {
      expect(isLegitAppCategory(v)).toBe(false);
    });
  });

  describe("isLegitAppTurnaround", () => {
    it.each(["ultra_fast", "fast", "standard"])("returns true for: %s", (t) => {
      expect(isLegitAppTurnaround(t)).toBe(true);
    });

    it.each(["slow", "FAST", "", null])("returns false for: %s", (v) => {
      expect(isLegitAppTurnaround(v)).toBe(false);
    });
  });

  describe("isAuthVerdict", () => {
    it.each(["AUTHENTIC", "COUNTERFEIT", "INCONCLUSIVE"])("returns true for: %s", (v) => {
      expect(isAuthVerdict(v)).toBe(true);
    });

    it.each(["REPLICA", "authentic", "", null])("returns false for: %s", (v) => {
      expect(isAuthVerdict(v)).toBe(false);
    });
  });

  describe("isAuthStatus", () => {
    it.each([
      "INTENT_CREATED", "PHOTOS_REQUESTED", "SUBMITTED", "COMPLETED", "EXPIRED",
    ])("returns true for: %s", (s) => {
      expect(isAuthStatus(s)).toBe(true);
    });

    it.each(["PENDING", "intent_created", "", null])("returns false for: %s", (v) => {
      expect(isAuthStatus(v)).toBe(false);
    });
  });

  describe("isAuthEventType", () => {
    it.each([
      "submission.received", "photos.requested", "authentication.completed",
    ])("returns true for: %s", (e) => {
      expect(isAuthEventType(e)).toBe(true);
    });

    it.each(["unknown.event", "SUBMISSION.RECEIVED", "", null])("returns false for: %s", (v) => {
      expect(isAuthEventType(v)).toBe(false);
    });
  });

  describe("isLegitAppRawVerdict", () => {
    it.each(["AUTHENTIC", "REPLICA", "INCONCLUSIVE"])("returns true for: %s", (v) => {
      expect(isLegitAppRawVerdict(v)).toBe(true);
    });

    it.each(["COUNTERFEIT", "authentic", "", null])("returns false for: %s", (v) => {
      expect(isLegitAppRawVerdict(v)).toBe(false);
    });
  });
});
