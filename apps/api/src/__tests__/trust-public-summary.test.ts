import { describe, expect, it } from "vitest";
import { toPublicTrustSummary } from "../services/trust-score.service.js";

describe("toPublicTrustSummary", () => {
  it("returns null when there is no score row", () => {
    expect(toPublicTrustSummary(null)).toBeNull();
    expect(toPublicTrustSummary(undefined)).toBeNull();
  });

  it("exposes only score, status, and completed deals", () => {
    const summary = toPublicTrustSummary({
      score: "81.2500",
      status: "MATURE",
      completedTransactions: 12,
    });
    expect(summary).toEqual({
      score: 81.25,
      status: "MATURE",
      completedTransactions: 12,
    });
    expect(JSON.stringify(summary)).not.toContain("raw");
  });

  it("treats unknown status as NEW and non-numeric score as null", () => {
    expect(
      toPublicTrustSummary({
        score: "not-a-number",
        status: "mystery",
        completedTransactions: null,
      }),
    ).toEqual({
      score: null,
      status: "NEW",
      completedTransactions: 0,
    });
  });
});
