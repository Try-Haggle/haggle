import { describe, it, expect } from "vitest";
import { createSnapshot } from "../snapshot.js";
import { WEIGHTS_VERSION } from "../weights.js";
import type { TrustInput } from "../types.js";

describe("snapshot", () => {
  const sampleInput: TrustInput = {
    transaction_completion_rate: 0.95,
    dispute_win_rate: 0.80,
    dispute_rate: 0.05,
    peer_rating: 4.2,
    transaction_frequency: 30,
    account_age_days: 200,
  };

  describe("createSnapshot", () => {
    it("should create a snapshot with all required fields", () => {
      const snapshot = createSnapshot("user_123", "2026-03-31", sampleInput, 85.5);
      expect(snapshot.user_id).toBe("user_123");
      expect(snapshot.snapshot_date).toBe("2026-03-31");
      expect(snapshot.computed_score).toBe(85.5);
      expect(snapshot.weights_version).toBe(WEIGHTS_VERSION);
      expect(snapshot.next_quarter_dispute).toBe(false);
    });

    it("should default next_quarter_dispute to false", () => {
      const snapshot = createSnapshot("user_1", "2026-01-01", {}, 50);
      expect(snapshot.next_quarter_dispute).toBe(false);
    });

    it("should use custom weights_version when provided", () => {
      const snapshot = createSnapshot("user_1", "2026-01-01", {}, 50, "v2.0");
      expect(snapshot.weights_version).toBe("v2.0");
    });

    it("should default to WEIGHTS_VERSION when no version provided", () => {
      const snapshot = createSnapshot("user_1", "2026-01-01", {}, 50);
      expect(snapshot.weights_version).toBe("v1.0");
    });

    it("should deep-copy raw_inputs to avoid mutation", () => {
      const input: TrustInput = { transaction_completion_rate: 0.9 };
      const snapshot = createSnapshot("user_1", "2026-01-01", input, 90);

      // Mutate original input
      input.transaction_completion_rate = 0.1;

      // Snapshot should retain original value
      expect(snapshot.raw_inputs.transaction_completion_rate).toBe(0.9);
    });

    it("should handle empty inputs", () => {
      const snapshot = createSnapshot("user_1", "2026-01-01", {}, 0);
      expect(snapshot.raw_inputs).toEqual({});
      expect(snapshot.computed_score).toBe(0);
    });
  });
});
