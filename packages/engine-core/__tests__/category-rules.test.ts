import { describe, expect, it } from "vitest";
import type { CategoryFeatureRule, ExtractedFeature } from "../src/features/types.js";
import { adjustVpForFeatures, applyFeatures, SEED_CATEGORY_FEATURE_RULES } from "../src/index.js";

function feat(
  key: string,
  value: ExtractedFeature["value"],
  type: ExtractedFeature["type"] = "value_adjust",
): ExtractedFeature {
  return { key, type, value, source: "seller_msg" };
}

function ruleFor(key: string): CategoryFeatureRule {
  const rule = SEED_CATEGORY_FEATURE_RULES.find((r) => r.key === key);
  if (!rule) throw new Error(`no seed rule for ${key}`);
  return rule;
}

describe("SEED_CATEGORY_FEATURE_RULES — structure", () => {
  it("covers exactly the value_adjust vocabulary, with unique rule ids and stable keys", () => {
    expect(SEED_CATEGORY_FEATURE_RULES.map((r) => r.key)).toEqual([
      "battery_health",
      "storage_capacity",
      "carrier_lock",
      "cosmetic_grade",
      "original_accessories",
    ]);
    const ids = SEED_CATEGORY_FEATURE_RULES.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("battery_health rule — sign, slope, bound", () => {
  const rule = ruleFor("battery_health");

  it("full health → no change", () => {
    expect(rule.apply(feat("battery_health", 100))).toEqual({
      vp_delta_ratio: 0,
      cap_applied: false,
    });
  });

  it("lower health → negative delta (worth less), proportional", () => {
    const r90 = rule.apply(feat("battery_health", 90));
    expect(r90.vp_delta_ratio).toBeCloseTo(-0.04, 10); // -0.004 * 10
    expect(r90.cap_applied).toBe(false);
  });

  it("very low health clamps to the per-rule bound", () => {
    const r10 = rule.apply(feat("battery_health", 10)); // raw -0.36
    expect(r10).toEqual({ vp_delta_ratio: -0.15, cap_applied: true });
  });

  it("null / non-numeric value → neutral (never NaN)", () => {
    expect(rule.apply(feat("battery_health", null))).toEqual({
      vp_delta_ratio: 0,
      cap_applied: false,
    });
  });
});

describe("enum ladders — direction is correct", () => {
  it("storage: bigger is worth more, 128GB is the baseline", () => {
    const rule = ruleFor("storage_capacity");
    expect(rule.apply(feat("storage_capacity", "128GB")).vp_delta_ratio).toBe(0);
    expect(rule.apply(feat("storage_capacity", "64GB")).vp_delta_ratio).toBeLessThan(0);
    expect(rule.apply(feat("storage_capacity", "1TB")).vp_delta_ratio).toBeGreaterThan(0);
    // case-insensitive
    expect(rule.apply(feat("storage_capacity", "256gb")).vp_delta_ratio).toBeGreaterThan(0);
    // unknown enum → neutral
    expect(rule.apply(feat("storage_capacity", "2TB")).vp_delta_ratio).toBe(0);
  });

  it("carrier_lock: locked is worth less, unlocked/unknown neutral", () => {
    const rule = ruleFor("carrier_lock");
    expect(rule.apply(feat("carrier_lock", "locked")).vp_delta_ratio).toBeLessThan(0);
    expect(rule.apply(feat("carrier_lock", "unlocked")).vp_delta_ratio).toBe(0);
    expect(rule.apply(feat("carrier_lock", null)).vp_delta_ratio).toBe(0);
  });

  it("cosmetic_grade: worse grade lowers value, poor hits the bound edge", () => {
    const rule = ruleFor("cosmetic_grade");
    expect(rule.apply(feat("cosmetic_grade", "mint")).vp_delta_ratio).toBeGreaterThan(0);
    expect(rule.apply(feat("cosmetic_grade", "excellent")).vp_delta_ratio).toBe(0);
    expect(rule.apply(feat("cosmetic_grade", "poor")).vp_delta_ratio).toBe(-0.15);
  });

  it("original_accessories: present raises value, absent neutral", () => {
    const rule = ruleFor("original_accessories");
    expect(rule.apply(feat("original_accessories", true)).vp_delta_ratio).toBeGreaterThan(0);
    expect(rule.apply(feat("original_accessories", false)).vp_delta_ratio).toBe(0);
  });
});

describe("every rule self-clamps within ITS OWN bound (contract invariant)", () => {
  // Each rule's individual bound — asserting the loose global 0.15 would hide a rule
  // that violated its own tighter bound (e.g. carrier 0.10, storage 0.12).
  const PER_RULE_BOUND: Record<string, number> = {
    battery_health: 0.15,
    storage_capacity: 0.12,
    carrier_lock: 0.1,
    cosmetic_grade: 0.15,
    original_accessories: 0.05,
  };
  const samples: ExtractedFeature["value"][] = [
    -999,
    -1e308,
    0,
    50,
    100,
    999,
    1e308,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    "64GB",
    "1TB",
    "256",
    "poor",
    "mint",
    "locked",
    "unlocked",
    true,
    false,
    null,
    "garbage",
    "",
  ];

  it("no rule ever exceeds its own bound, and never leaks NaN/-0, across malformed inputs", () => {
    for (const rule of SEED_CATEGORY_FEATURE_RULES) {
      const bound = PER_RULE_BOUND[rule.key]!;
      for (const value of samples) {
        const { vp_delta_ratio } = rule.apply(feat(rule.key, value));
        expect(Number.isFinite(vp_delta_ratio)).toBe(true);
        expect(vp_delta_ratio).toBeGreaterThanOrEqual(-bound);
        expect(vp_delta_ratio).toBeLessThanOrEqual(bound);
        expect(Object.is(vp_delta_ratio, -0)).toBe(false); // canonical +0 only
      }
    }
  });

  it("battery survives Infinity/NaN input as neutral, not NaN", () => {
    const rule = ruleFor("battery_health");
    expect(rule.apply(feat("battery_health", Number.NaN)).vp_delta_ratio).toBe(0);
    expect(rule.apply(feat("battery_health", Number.POSITIVE_INFINITY)).vp_delta_ratio).toBe(0);
  });
});

describe("integration through applyFeatures (the real consumer path)", () => {
  it("maps a batch of extracted features to bounded adjustments", () => {
    const features: ExtractedFeature[] = [
      feat("battery_health", 85),
      feat("storage_capacity", "256GB"),
      feat("carrier_lock", "locked"),
    ];
    const { adjustments, missing } = applyFeatures(features, SEED_CATEGORY_FEATURE_RULES);
    expect(missing).toEqual([]);
    expect(adjustments.map((a) => a.key)).toEqual([
      "battery_health",
      "storage_capacity",
      "carrier_lock",
    ]);
    // battery below 100 and locked are negative; more storage is positive.
    const byKey = Object.fromEntries(adjustments.map((a) => [a.key, a.vp_delta_ratio]));
    expect(byKey.battery_health).toBeLessThan(0);
    expect(byKey.carrier_lock).toBeLessThan(0);
    expect(byKey.storage_capacity).toBeGreaterThan(0);
  });

  it("features with a null value (mentioned, unknown) route to missing, not adjustments", () => {
    const { adjustments, missing } = applyFeatures(
      [feat("battery_health", null)],
      SEED_CATEGORY_FEATURE_RULES,
    );
    expect(adjustments).toEqual([]);
    expect(missing.map((m) => m.key)).toEqual(["battery_health"]);
  });

  it("a feature with no seed rule routes to missing", () => {
    const { adjustments, missing } = applyFeatures(
      [feat("mystery_feature", 5)],
      SEED_CATEGORY_FEATURE_RULES,
    );
    expect(adjustments).toEqual([]);
    expect(missing.map((m) => m.key)).toEqual(["mystery_feature"]);
  });

  it("worst-case composition (all levers negative) keeps V_p in [0,1], never flips sign", () => {
    // The compounding lands downstream in adjustVpForFeatures (multiplicative). This is
    // a smoke test that the seed bounds + final clamp keep the composed result sane —
    // the aggregate cap policy itself remains a Group-1 kickoff item.
    const worstDown = applyFeatures(
      [
        feat("battery_health", 0), // -0.15
        feat("storage_capacity", "64GB"), // -0.06
        feat("carrier_lock", "locked"), // -0.08
        feat("cosmetic_grade", "poor"), // -0.15
      ],
      SEED_CATEGORY_FEATURE_RULES,
    );
    const vp = 0.9;
    const composed = adjustVpForFeatures(vp, worstDown.adjustments);
    expect(composed).toBeGreaterThanOrEqual(0);
    expect(composed).toBeLessThanOrEqual(1);
    expect(composed).toBeLessThan(vp); // net downward
  });

  it("worst-case upward composition clamps to 1 (no overshoot leaks)", () => {
    const worstUp = applyFeatures(
      [
        feat("storage_capacity", "1TB"), // +0.12
        feat("cosmetic_grade", "mint"), // +0.05
        feat("original_accessories", true), // +0.04
      ],
      SEED_CATEGORY_FEATURE_RULES,
    );
    const composed = adjustVpForFeatures(0.98, worstUp.adjustments);
    expect(composed).toBeLessThanOrEqual(1);
    expect(composed).toBeGreaterThan(0);
  });
});
