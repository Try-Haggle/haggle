import { describe, it, expect } from "vitest";
import {
  DEFAULT_WEIGHT_CONFIG,
  WEIGHTS_VERSION,
  getApplicableKeys,
  redistributeWeights,
  getInputConfig,
} from "../weights.js";
import type { TrustInputKey } from "../types.js";

describe("weights", () => {
  describe("DEFAULT_WEIGHT_CONFIG", () => {
    it("should have exactly 9 input keys", () => {
      const keys = Object.keys(DEFAULT_WEIGHT_CONFIG);
      expect(keys).toHaveLength(9);
    });

    it("should have weights that sum to 1.0", () => {
      const total = Object.values(DEFAULT_WEIGHT_CONFIG).reduce(
        (sum, cfg) => sum + cfg.weight,
        0,
      );
      expect(total).toBeCloseTo(1.0, 10);
    });

    it("should have a version string", () => {
      expect(WEIGHTS_VERSION).toBe("v1.0");
    });
  });

  describe("getApplicableKeys", () => {
    it("should return all 9 keys for combined role", () => {
      const keys = getApplicableKeys(DEFAULT_WEIGHT_CONFIG, "combined");
      expect(keys).toHaveLength(9);
    });

    it("should exclude auto_confirm_rate for seller role", () => {
      const keys = getApplicableKeys(DEFAULT_WEIGHT_CONFIG, "seller");
      expect(keys).not.toContain("auto_confirm_rate");
    });

    it("should exclude sla_compliance_rate for buyer role", () => {
      const keys = getApplicableKeys(DEFAULT_WEIGHT_CONFIG, "buyer");
      expect(keys).not.toContain("sla_compliance_rate");
    });

    it("should include peer_rating for both seller and buyer", () => {
      const sellerKeys = getApplicableKeys(DEFAULT_WEIGHT_CONFIG, "seller");
      const buyerKeys = getApplicableKeys(DEFAULT_WEIGHT_CONFIG, "buyer");
      expect(sellerKeys).toContain("peer_rating");
      expect(buyerKeys).toContain("peer_rating");
    });

    it("should return 8 keys for seller (excludes auto_confirm_rate)", () => {
      const keys = getApplicableKeys(DEFAULT_WEIGHT_CONFIG, "seller");
      expect(keys).toHaveLength(8);
    });

    it("should return 8 keys for buyer (excludes sla_compliance_rate)", () => {
      const keys = getApplicableKeys(DEFAULT_WEIGHT_CONFIG, "buyer");
      expect(keys).toHaveLength(8);
    });
  });

  describe("redistributeWeights", () => {
    it("should return weights summing to 1.0 when all keys defined", () => {
      const allKeys = Object.keys(DEFAULT_WEIGHT_CONFIG) as TrustInputKey[];
      const result = redistributeWeights(DEFAULT_WEIGHT_CONFIG, allKeys, allKeys);
      const total = Array.from(result.values()).reduce((s, v) => s + v, 0);
      expect(total).toBeCloseTo(1.0, 10);
    });

    it("should redistribute when some keys are missing", () => {
      const allKeys = Object.keys(DEFAULT_WEIGHT_CONFIG) as TrustInputKey[];
      const definedKeys: TrustInputKey[] = [
        "transaction_completion_rate",
        "dispute_win_rate",
      ];
      const result = redistributeWeights(DEFAULT_WEIGHT_CONFIG, allKeys, definedKeys);
      const total = Array.from(result.values()).reduce((s, v) => s + v, 0);
      expect(total).toBeCloseTo(1.0, 10);
      expect(result.size).toBe(2);
    });

    it("should return empty map when no keys are defined", () => {
      const allKeys = Object.keys(DEFAULT_WEIGHT_CONFIG) as TrustInputKey[];
      const result = redistributeWeights(DEFAULT_WEIGHT_CONFIG, allKeys, []);
      expect(result.size).toBe(0);
    });

    it("should preserve relative weight ratios", () => {
      const allKeys = Object.keys(DEFAULT_WEIGHT_CONFIG) as TrustInputKey[];
      const definedKeys: TrustInputKey[] = [
        "transaction_completion_rate",  // 0.20
        "dispute_win_rate",             // 0.18
      ];
      const result = redistributeWeights(DEFAULT_WEIGHT_CONFIG, allKeys, definedKeys);
      const w1 = result.get("transaction_completion_rate")!;
      const w2 = result.get("dispute_win_rate")!;
      // Ratio should be 20/18
      expect(w1 / w2).toBeCloseTo(20 / 18, 5);
    });

    it("should ignore defined keys not in applicable set", () => {
      const applicableKeys: TrustInputKey[] = ["transaction_completion_rate"];
      const definedKeys: TrustInputKey[] = [
        "transaction_completion_rate",
        "auto_confirm_rate",
      ];
      const result = redistributeWeights(DEFAULT_WEIGHT_CONFIG, applicableKeys, definedKeys);
      expect(result.size).toBe(1);
      expect(result.get("transaction_completion_rate")).toBe(1.0);
    });
  });

  describe("getInputConfig", () => {
    it("should return correct config for transaction_completion_rate", () => {
      const cfg = getInputConfig(DEFAULT_WEIGHT_CONFIG, "transaction_completion_rate");
      expect(cfg.weight).toBe(0.20);
      expect(cfg.direction).toBe("higher");
      expect(cfg.normalization).toBe("rate");
      expect(cfg.applies_to_seller).toBe(true);
      expect(cfg.applies_to_buyer).toBe(true);
    });

    it("should return correct config for dispute_rate (inverse)", () => {
      const cfg = getInputConfig(DEFAULT_WEIGHT_CONFIG, "dispute_rate");
      expect(cfg.direction).toBe("lower");
      expect(cfg.normalization).toBe("inverse_rate");
    });
  });
});
