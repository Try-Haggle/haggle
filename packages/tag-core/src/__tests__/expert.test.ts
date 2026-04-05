import { describe, it, expect } from "vitest";
import { isExpertQualified, qualifyExpert, qualifyExperts } from "../expert.js";
import type { ExpertCandidateInput } from "../types.js";
import { defaultTagConfig } from "../types.js";

const NOW = "2026-04-01T00:00:00Z";

function makeCandidate(overrides: Partial<ExpertCandidateInput> = {}): ExpertCandidateInput {
  return {
    userId: "user-1",
    tagId: "tag-1",
    category: "ELECTRONICS_SMALL",
    caseCount: 60,
    accuracy: 0.90,
    ...overrides,
  };
}

describe("isExpertQualified", () => {
  it("qualifies with sufficient cases and accuracy", () => {
    expect(isExpertQualified(makeCandidate())).toBe(true);
  });

  it("rejects insufficient case count", () => {
    expect(isExpertQualified(makeCandidate({ caseCount: 30 }))).toBe(false);
  });

  it("rejects insufficient accuracy", () => {
    expect(isExpertQualified(makeCandidate({ accuracy: 0.80 }))).toBe(false);
  });

  it("qualifies at exact thresholds", () => {
    expect(
      isExpertQualified(makeCandidate({ caseCount: 50, accuracy: 0.85 })),
    ).toBe(true);
  });

  it("uses custom config thresholds", () => {
    const config = {
      ...defaultTagConfig(),
      expertMinCases: 100,
      expertMinAccuracy: 0.95,
    };
    expect(isExpertQualified(makeCandidate({ caseCount: 60, accuracy: 0.90 }), config)).toBe(false);
  });
});

describe("qualifyExpert", () => {
  it("returns ExpertTag for qualified candidate", () => {
    const result = qualifyExpert(makeCandidate(), NOW);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("user-1");
    expect(result!.qualifiedAt).toBe(NOW);
  });

  it("returns null for unqualified candidate", () => {
    const result = qualifyExpert(makeCandidate({ caseCount: 10 }), NOW);
    expect(result).toBeNull();
  });
});

describe("qualifyExperts", () => {
  it("filters to only qualified candidates", () => {
    const candidates = [
      makeCandidate({ userId: "u1", caseCount: 60, accuracy: 0.90 }),
      makeCandidate({ userId: "u2", caseCount: 10, accuracy: 0.90 }),
      makeCandidate({ userId: "u3", caseCount: 55, accuracy: 0.86 }),
    ];
    const results = qualifyExperts(candidates, NOW);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.userId)).toEqual(["u1", "u3"]);
  });

  it("returns empty array when none qualify", () => {
    const candidates = [
      makeCandidate({ caseCount: 5, accuracy: 0.50 }),
    ];
    const results = qualifyExperts(candidates, NOW);
    expect(results).toHaveLength(0);
  });
});
