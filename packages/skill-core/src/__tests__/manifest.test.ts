import { describe, it, expect } from "vitest";
import {
  validateManifest,
  isCompatibleHookPoint,
  isCompatibleCategory,
} from "../manifest.js";
import type { SkillManifest } from "../types.js";

function makeValidManifest(overrides?: Partial<SkillManifest>): SkillManifest {
  return {
    skillId: "legit-app-auth-v1",
    name: "Legit App Authentication",
    description: "Authenticates sneakers via Legit App",
    version: "1.0.0",
    category: "AUTHENTICATION",
    provider: "THIRD_PARTY",
    supportedCategories: ["sneakers", "watches"],
    hookPoints: ["ON_LISTING_CREATE"],
    pricing: { model: "PER_USE", perUseCents: 50 },
    ...overrides,
  };
}

describe("validateManifest", () => {
  it("accepts a valid manifest", () => {
    const result = validateManifest(makeValidManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects empty skillId", () => {
    const result = validateManifest(makeValidManifest({ skillId: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("skillId"))).toBe(true);
  });

  it("rejects skillId longer than 64 chars", () => {
    const result = validateManifest(makeValidManifest({ skillId: "a".repeat(65) }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("64"))).toBe(true);
  });

  it("rejects uppercase skillId", () => {
    const result = validateManifest(makeValidManifest({ skillId: "Legit-App" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("lowercase"))).toBe(true);
  });

  it("rejects skillId with special characters", () => {
    const result = validateManifest(makeValidManifest({ skillId: "legit_app!" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("lowercase"))).toBe(true);
  });

  it("accepts single-char skillId", () => {
    const result = validateManifest(makeValidManifest({ skillId: "a" }));
    expect(result.valid).toBe(true);
  });

  it("rejects empty name", () => {
    const result = validateManifest(makeValidManifest({ name: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects name longer than 128 chars", () => {
    const result = validateManifest(makeValidManifest({ name: "x".repeat(129) }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("128"))).toBe(true);
  });

  it("rejects invalid version (not semver)", () => {
    const result = validateManifest(makeValidManifest({ version: "v1.0" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("semver"))).toBe(true);
  });

  it("rejects invalid category", () => {
    const result = validateManifest(
      makeValidManifest({ category: "INVALID" as any }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("category"))).toBe(true);
  });

  it("rejects empty hookPoints", () => {
    const result = validateManifest(makeValidManifest({ hookPoints: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("hookPoints"))).toBe(true);
  });

  it("rejects empty supportedCategories", () => {
    const result = validateManifest(makeValidManifest({ supportedCategories: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("supportedCategories"))).toBe(true);
  });

  it("rejects PER_USE without perUseCents", () => {
    const result = validateManifest(
      makeValidManifest({ pricing: { model: "PER_USE" } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("perUseCents"))).toBe(true);
  });

  it("rejects SUBSCRIPTION without monthlySubscriptionCents", () => {
    const result = validateManifest(
      makeValidManifest({ pricing: { model: "SUBSCRIPTION" } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("monthlySubscriptionCents"))).toBe(true);
  });

  it("rejects REVENUE_SHARE with percent out of range", () => {
    const result = validateManifest(
      makeValidManifest({
        pricing: { model: "REVENUE_SHARE", revenueSharePercent: 150 },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("revenueSharePercent"))).toBe(true);
  });

  it("accepts REVENUE_SHARE with percent at boundary (0)", () => {
    const result = validateManifest(
      makeValidManifest({
        pricing: { model: "REVENUE_SHARE", revenueSharePercent: 0 },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts FREE pricing with no extra fields", () => {
    const result = validateManifest(
      makeValidManifest({ pricing: { model: "FREE" } }),
    );
    expect(result.valid).toBe(true);
  });

  it("collects multiple errors at once", () => {
    const result = validateManifest(
      makeValidManifest({
        skillId: "",
        name: "",
        version: "bad",
        hookPoints: [],
        supportedCategories: [],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("isCompatibleHookPoint", () => {
  it("returns true for a declared hook point", () => {
    const manifest = makeValidManifest({ hookPoints: ["PRE_SESSION", "POST_SESSION"] });
    expect(isCompatibleHookPoint(manifest, "PRE_SESSION")).toBe(true);
  });

  it("returns false for an undeclared hook point", () => {
    const manifest = makeValidManifest({ hookPoints: ["PRE_SESSION"] });
    expect(isCompatibleHookPoint(manifest, "POST_ROUND")).toBe(false);
  });
});

describe("isCompatibleCategory", () => {
  it("matches exact category", () => {
    const manifest = makeValidManifest({ supportedCategories: ["sneakers", "watches"] });
    expect(isCompatibleCategory(manifest, "sneakers")).toBe(true);
  });

  it("returns false for non-matching category", () => {
    const manifest = makeValidManifest({ supportedCategories: ["sneakers"] });
    expect(isCompatibleCategory(manifest, "electronics")).toBe(false);
  });

  it("wildcard matches subcategory", () => {
    const manifest = makeValidManifest({ supportedCategories: ["vehicles.*"] });
    expect(isCompatibleCategory(manifest, "vehicles.cars")).toBe(true);
  });

  it("wildcard matches deep subcategory", () => {
    const manifest = makeValidManifest({ supportedCategories: ["vehicles.*"] });
    expect(isCompatibleCategory(manifest, "vehicles.cars.sedans")).toBe(true);
  });

  it("wildcard does NOT match the parent itself", () => {
    const manifest = makeValidManifest({ supportedCategories: ["vehicles.*"] });
    expect(isCompatibleCategory(manifest, "vehicles")).toBe(false);
  });

  it("wildcard does NOT match unrelated category", () => {
    const manifest = makeValidManifest({ supportedCategories: ["vehicles.*"] });
    expect(isCompatibleCategory(manifest, "electronics")).toBe(false);
  });
});
