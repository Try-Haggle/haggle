import { describe, it, expect } from "vitest";
import {
  computeTrustScore,
  determineTrustStatus,
  computeSlaPenaltyFactor,
  SCORING_THRESHOLD,
  MATURE_THRESHOLD,
  SLA_PENALTY_PER_VIOLATION,
  SLA_PENALTY_MAX,
} from "../compute.js";
import type { TrustInput, ComputeOptions } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Perfect seller inputs — all metrics at ideal values. */
const PERFECT_SELLER_INPUT: TrustInput = {
  transaction_completion_rate: 1.0,
  dispute_win_rate: 1.0,
  dispute_rate: 0.0,           // lower is better -> inverted to 1.0
  sla_compliance_rate: 1.0,
  cancellation_rate: 0.0,      // lower is better -> inverted to 1.0
  peer_rating: 5.0,
  transaction_frequency: 100,
  account_age_days: 365,
};

/** Perfect buyer inputs. */
const PERFECT_BUYER_INPUT: TrustInput = {
  transaction_completion_rate: 1.0,
  dispute_win_rate: 1.0,
  dispute_rate: 0.0,
  cancellation_rate: 0.0,
  auto_confirm_rate: 1.0,
  peer_rating: 5.0,
  transaction_frequency: 100,
  account_age_days: 365,
};

/** Mediocre inputs — middle-of-the-road values. */
const MEDIOCRE_INPUT: TrustInput = {
  transaction_completion_rate: 0.5,
  dispute_win_rate: 0.5,
  dispute_rate: 0.5,
  sla_compliance_rate: 0.5,
  cancellation_rate: 0.5,
  auto_confirm_rate: 0.5,
  peer_rating: 2.5,
  transaction_frequency: 50,
  account_age_days: 182,
};

describe("compute", () => {
  // -----------------------------------------------------------------------
  // Cold-start status
  // -----------------------------------------------------------------------
  describe("determineTrustStatus", () => {
    it("should return NEW for 0 transactions", () => {
      expect(determineTrustStatus(0)).toBe("NEW");
    });

    it("should return NEW for 4 transactions", () => {
      expect(determineTrustStatus(4)).toBe("NEW");
    });

    it("should return SCORING for 5 transactions", () => {
      expect(determineTrustStatus(5)).toBe("SCORING");
    });

    it("should return SCORING for 19 transactions", () => {
      expect(determineTrustStatus(19)).toBe("SCORING");
    });

    it("should return MATURE for 20 transactions", () => {
      expect(determineTrustStatus(20)).toBe("MATURE");
    });

    it("should return MATURE for 100 transactions", () => {
      expect(determineTrustStatus(100)).toBe("MATURE");
    });

    it("should expose threshold constants", () => {
      expect(SCORING_THRESHOLD).toBe(5);
      expect(MATURE_THRESHOLD).toBe(20);
    });
  });

  // -----------------------------------------------------------------------
  // SLA penalty
  // -----------------------------------------------------------------------
  describe("computeSlaPenaltyFactor", () => {
    it("should return 1.0 when no penalty provided", () => {
      expect(computeSlaPenaltyFactor(undefined)).toBe(1.0);
    });

    it("should return 1.0 for 0 violations", () => {
      expect(computeSlaPenaltyFactor({ sla_violation_count: 0 })).toBe(1.0);
    });

    it("should return 0.98 for 1 violation", () => {
      expect(computeSlaPenaltyFactor({ sla_violation_count: 1 })).toBeCloseTo(0.98, 10);
    });

    it("should return 0.90 for 5 violations", () => {
      expect(computeSlaPenaltyFactor({ sla_violation_count: 5 })).toBeCloseTo(0.90, 10);
    });

    it("should cap at 0.80 for 10 violations", () => {
      expect(computeSlaPenaltyFactor({ sla_violation_count: 10 })).toBeCloseTo(0.80, 10);
    });

    it("should cap at 0.80 for 50 violations", () => {
      expect(computeSlaPenaltyFactor({ sla_violation_count: 50 })).toBeCloseTo(0.80, 10);
    });

    it("should expose penalty constants", () => {
      expect(SLA_PENALTY_PER_VIOLATION).toBe(0.02);
      expect(SLA_PENALTY_MAX).toBe(0.20);
    });
  });

  // -----------------------------------------------------------------------
  // Cold start (NEW status)
  // -----------------------------------------------------------------------
  describe("cold start", () => {
    it("should return score 0 and status NEW for < 5 transactions", () => {
      const result = computeTrustScore(PERFECT_SELLER_INPUT, {
        completed_transactions: 3,
      });
      expect(result.score).toBe(0);
      expect(result.status).toBe("NEW");
      expect(result.sla_penalty_factor).toBe(1.0);
    });

    it("should return score 0 for 0 completed transactions", () => {
      const result = computeTrustScore({}, { completed_transactions: 0 });
      expect(result.score).toBe(0);
      expect(result.status).toBe("NEW");
    });
  });

  // -----------------------------------------------------------------------
  // Perfect scores
  // -----------------------------------------------------------------------
  describe("perfect scores", () => {
    it("should return 100 for a perfect seller", () => {
      const result = computeTrustScore(PERFECT_SELLER_INPUT, {
        role: "seller",
        completed_transactions: 100,
      });
      expect(result.score).toBe(100);
      expect(result.status).toBe("MATURE");
    });

    it("should return 100 for a perfect buyer", () => {
      const result = computeTrustScore(PERFECT_BUYER_INPUT, {
        role: "buyer",
        completed_transactions: 100,
      });
      expect(result.score).toBe(100);
      expect(result.status).toBe("MATURE");
    });

    it("should return 100 for perfect combined (all inputs)", () => {
      const allPerfect: TrustInput = {
        ...PERFECT_SELLER_INPUT,
        auto_confirm_rate: 1.0,
      };
      const result = computeTrustScore(allPerfect, {
        role: "combined",
        completed_transactions: 100,
      });
      expect(result.score).toBe(100);
    });
  });

  // -----------------------------------------------------------------------
  // Mediocre scores
  // -----------------------------------------------------------------------
  describe("mediocre scores", () => {
    it("should return ~50 for mediocre combined inputs", () => {
      const result = computeTrustScore(MEDIOCRE_INPUT, {
        role: "combined",
        completed_transactions: 25,
      });
      // All normalized values ~0.5, so weighted sum ~0.5, score ~50
      expect(result.score).toBeGreaterThan(45);
      expect(result.score).toBeLessThan(55);
    });
  });

  // -----------------------------------------------------------------------
  // Worst scores
  // -----------------------------------------------------------------------
  describe("worst scores", () => {
    it("should return 0 for worst possible inputs", () => {
      const worstInput: TrustInput = {
        transaction_completion_rate: 0,
        dispute_win_rate: 0,
        dispute_rate: 1.0,         // worst: all disputes
        sla_compliance_rate: 0,
        cancellation_rate: 1.0,    // worst: all cancelled
        auto_confirm_rate: 0,
        peer_rating: 0,
        transaction_frequency: 0,
        account_age_days: 0,
      };
      const result = computeTrustScore(worstInput, {
        role: "combined",
        completed_transactions: 50,
      });
      expect(result.score).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Role filtering
  // -----------------------------------------------------------------------
  describe("role filtering", () => {
    it("should exclude sla_compliance_rate for buyer role", () => {
      const input: TrustInput = {
        transaction_completion_rate: 1.0,
        sla_compliance_rate: 0.0,   // should be ignored for buyer
      };
      const result = computeTrustScore(input, {
        role: "buyer",
        completed_transactions: 10,
      });
      // Only transaction_completion_rate should contribute, all weight on it
      expect(result.score).toBe(100);
    });

    it("should exclude auto_confirm_rate for seller role", () => {
      const input: TrustInput = {
        transaction_completion_rate: 1.0,
        auto_confirm_rate: 0.0,     // should be ignored for seller
      };
      const result = computeTrustScore(input, {
        role: "seller",
        completed_transactions: 10,
      });
      expect(result.score).toBe(100);
    });

    it("should default role to combined", () => {
      const result = computeTrustScore(PERFECT_SELLER_INPUT, {
        completed_transactions: 10,
      });
      expect(result.role).toBe("combined");
    });
  });

  // -----------------------------------------------------------------------
  // Weight redistribution with missing inputs
  // -----------------------------------------------------------------------
  describe("missing inputs", () => {
    it("should score based only on defined inputs", () => {
      const input: TrustInput = {
        transaction_completion_rate: 1.0,
        // all other inputs undefined
      };
      const result = computeTrustScore(input, {
        role: "combined",
        completed_transactions: 10,
      });
      // Only one input at 1.0 with full weight -> score = 100
      expect(result.score).toBe(100);
    });

    it("should return 0 when all inputs are undefined (but not NEW)", () => {
      const result = computeTrustScore({}, {
        role: "combined",
        completed_transactions: 10,
      });
      expect(result.score).toBe(0);
      expect(result.status).toBe("SCORING");
    });
  });

  // -----------------------------------------------------------------------
  // SLA penalty integration
  // -----------------------------------------------------------------------
  describe("SLA penalty integration", () => {
    it("should reduce score by SLA penalty factor", () => {
      const result = computeTrustScore(PERFECT_SELLER_INPUT, {
        role: "seller",
        completed_transactions: 50,
        sla_penalty: { sla_violation_count: 5 },
      });
      expect(result.raw_score).toBe(100);
      expect(result.sla_penalty_factor).toBeCloseTo(0.90, 10);
      expect(result.score).toBe(90);
    });

    it("should apply max 20% penalty", () => {
      const result = computeTrustScore(PERFECT_SELLER_INPUT, {
        role: "seller",
        completed_transactions: 50,
        sla_penalty: { sla_violation_count: 100 },
      });
      expect(result.sla_penalty_factor).toBeCloseTo(0.80, 10);
      expect(result.score).toBe(80);
    });

    it("should not apply penalty when sla_violation_count is 0", () => {
      const result = computeTrustScore(PERFECT_SELLER_INPUT, {
        role: "seller",
        completed_transactions: 50,
        sla_penalty: { sla_violation_count: 0 },
      });
      expect(result.score).toBe(100);
      expect(result.sla_penalty_factor).toBe(1.0);
    });
  });

  // -----------------------------------------------------------------------
  // Clamping
  // -----------------------------------------------------------------------
  describe("clamping", () => {
    it("should never exceed 100", () => {
      const input: TrustInput = {
        transaction_completion_rate: 2.0, // will be clamped to 1.0 by normalizeRate
      };
      const result = computeTrustScore(input, {
        completed_transactions: 10,
      });
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it("should never go below 0", () => {
      const input: TrustInput = {
        transaction_completion_rate: -1.0, // will be clamped to 0 by normalizeRate
      };
      const result = computeTrustScore(input, {
        completed_transactions: 10,
      });
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Result metadata
  // -----------------------------------------------------------------------
  describe("result metadata", () => {
    it("should include weights_version", () => {
      const result = computeTrustScore(PERFECT_SELLER_INPUT, {
        completed_transactions: 10,
      });
      expect(result.weights_version).toBe("v1.0");
    });

    it("should include completed_transactions in result", () => {
      const result = computeTrustScore(PERFECT_SELLER_INPUT, {
        completed_transactions: 42,
      });
      expect(result.completed_transactions).toBe(42);
    });

    it("should include role in result", () => {
      const result = computeTrustScore(PERFECT_SELLER_INPUT, {
        role: "seller",
        completed_transactions: 10,
      });
      expect(result.role).toBe("seller");
    });

    it("should round score to 2 decimal places", () => {
      // Use inputs that produce a score with many decimals
      const input: TrustInput = {
        transaction_completion_rate: 0.333,
        dispute_win_rate: 0.667,
      };
      const result = computeTrustScore(input, {
        completed_transactions: 10,
      });
      const decimalPart = result.score.toString().split(".")[1] ?? "";
      expect(decimalPart.length).toBeLessThanOrEqual(2);
    });
  });
});
