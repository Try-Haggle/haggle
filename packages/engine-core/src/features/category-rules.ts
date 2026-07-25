import type { CategoryFeatureRule, ExtractedFeature } from "./types.js";

/**
 * Seed category feature rules (L5 / H6) — the missing link between the sensor's
 * ExtractedFeatures and a bounded price effect.
 *
 * `applyFeatures(features, rules)` is already wired into the hybrid bridge
 * (assembleNegotiationContext), but it is handed an EMPTY rule list by default, so
 * extracted features currently move nothing. These rules fill that gap for the
 * value_adjust vocabulary.
 *
 * Ownership / scope (Group 2 loop discipline, §8):
 *  - The feature set + the SIGN and BOUND of each effect are Group 2's turf (pillar A
 *    semantics) — those are fixed and correct here.
 *  - The MAGNITUDE of each effect is Group 1 calibration. The numbers below are
 *    deliberate, clearly-bounded MOCKS — see // TODO(group1): calibrate on each rule.
 *  - Each rule self-clamps its output (the CategoryFeatureRule contract): the engine
 *    trusts the returned vp_delta_ratio to already be bounded.
 *  - NOT auto-wired. assembleNegotiationContext still defaults categoryRules to []; a
 *    caller (Group 1, once the engine price path is live) opts in. Until then this is
 *    shadow, proven by tests.
 *  - ⚠️ Compounding: applyFeatures' downstream composition (adjustVpForFeatures) is
 *    MULTIPLICATIVE (group1-owned). Per-rule bounds here limit each lever, but the
 *    global composition cap across many features is a kickoff item (§8 checklist #3).
 *
 * Pure + deterministic. No I/O, no randomness.
 */

/** Clamp helper (engine-core has one in utils, but keep this file dependency-light). */
function clampRatio(
  ratio: number,
  bound: number,
): { vp_delta_ratio: number; cap_applied: boolean } {
  // Total safety net: a non-finite ratio (a future rule doing unguarded arithmetic)
  // collapses to neutral rather than leaking NaN downstream.
  if (!Number.isFinite(ratio)) return { vp_delta_ratio: 0, cap_applied: false };
  const lo = -bound;
  const hi = bound;
  if (ratio < lo) return { vp_delta_ratio: lo, cap_applied: true };
  if (ratio > hi) return { vp_delta_ratio: hi, cap_applied: true };
  // Normalize -0 → 0 so callers/tests see a canonical zero.
  return { vp_delta_ratio: ratio === 0 ? 0 : ratio, cap_applied: false };
}

function asNumber(value: ExtractedFeature["value"]): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: ExtractedFeature["value"]): string | null {
  return typeof value === "string" ? value.toLowerCase() : null;
}

// Per-feature bounds (the max absolute V_p ratio a single lever may move). MOCK.
const BATTERY_BOUND = 0.15;
const STORAGE_BOUND = 0.12;
const CARRIER_BOUND = 0.1;
const COSMETIC_BOUND = 0.15;
const ACCESSORIES_BOUND = 0.05;

/**
 * battery_health (%) → the further below 100% health, the lower the value.
 * MOCK slope: -0.4% of V_p per 1% health below 100. // TODO(group1): calibrate.
 */
const batteryHealthRule: CategoryFeatureRule = {
  category: "electronics/phones",
  key: "battery_health",
  rule_id: "battery_health.v1",
  apply(feature) {
    const pct = asNumber(feature.value);
    if (pct === null) return { vp_delta_ratio: 0, cap_applied: false };
    const belowFull = Math.max(0, 100 - pct);
    return clampRatio(-0.004 * belowFull, BATTERY_BOUND);
  },
};

/**
 * storage_capacity (enum) → higher capacity raises value. MOCK ladder centered on
 * 128GB as the neutral baseline. // TODO(group1): calibrate.
 */
const STORAGE_LADDER: Record<string, number> = {
  "64gb": -0.06,
  "128gb": 0,
  "256gb": 0.05,
  "512gb": 0.09,
  "1tb": 0.12,
};
const storageCapacityRule: CategoryFeatureRule = {
  category: "electronics/phones",
  key: "storage_capacity",
  rule_id: "storage_capacity.v1",
  apply(feature) {
    const val = asString(feature.value);
    const ratio = val ? (STORAGE_LADDER[val] ?? 0) : 0;
    return clampRatio(ratio, STORAGE_BOUND);
  },
};

/**
 * carrier_lock (enum) → a locked device is worth less; unlocked is the baseline.
 * MOCK. // TODO(group1): calibrate.
 */
const carrierLockRule: CategoryFeatureRule = {
  category: "electronics/phones",
  key: "carrier_lock",
  rule_id: "carrier_lock.v1",
  apply(feature) {
    const val = asString(feature.value);
    const ratio = val === "locked" ? -0.08 : 0; // unlocked / unknown → neutral
    return clampRatio(ratio, CARRIER_BOUND);
  },
};

/**
 * cosmetic_grade (enum, universal) → worse grades lower value; "excellent" baseline.
 * MOCK ladder. // TODO(group1): calibrate.
 */
const COSMETIC_LADDER: Record<string, number> = {
  mint: 0.05,
  excellent: 0,
  good: -0.04,
  fair: -0.09,
  poor: -0.15,
};
const cosmeticGradeRule: CategoryFeatureRule = {
  category: "*",
  key: "cosmetic_grade",
  rule_id: "cosmetic_grade.v1",
  apply(feature) {
    const val = asString(feature.value);
    const ratio = val ? (COSMETIC_LADDER[val] ?? 0) : 0;
    return clampRatio(ratio, COSMETIC_BOUND);
  },
};

/**
 * original_accessories (boolean, universal) → having original box/accessories raises
 * value slightly. MOCK. // TODO(group1): calibrate.
 */
const originalAccessoriesRule: CategoryFeatureRule = {
  category: "*",
  key: "original_accessories",
  rule_id: "original_accessories.v1",
  apply(feature) {
    const ratio = feature.value === true ? 0.04 : 0;
    return clampRatio(ratio, ACCESSORIES_BOUND);
  },
};

/**
 * The seed value_adjust rule table. Mirrors the value_adjust entries of FEATURE_SCHEMA.
 * Callers pass this into applyFeatures; it is not auto-applied to production price.
 */
export const SEED_CATEGORY_FEATURE_RULES: readonly CategoryFeatureRule[] = [
  batteryHealthRule,
  storageCapacityRule,
  carrierLockRule,
  cosmeticGradeRule,
  originalAccessoriesRule,
];
