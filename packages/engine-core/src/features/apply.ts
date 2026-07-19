import type {
  CategoryFeatureRule,
  ExtractedFeature,
  FeatureAdjustment,
  FeatureApplication,
} from "./types.js";

/**
 * Apply extracted features against the category rule table → bounded adjustments + a
 * `missing` list (unknown value or no rule) that Tag Garden (H7) turns into questions.
 *
 * STUB (H6): the value_adjust routing + missing collection are wired; `term` routing
 * into NegotiationContext.term_space is left as a TODO for H8. Deterministic — no I/O,
 * no randomness.
 */
export function applyFeatures(
  features: readonly ExtractedFeature[],
  rules: readonly CategoryFeatureRule[],
): FeatureApplication {
  const adjustments: FeatureAdjustment[] = [];
  const missing: ExtractedFeature[] = [];

  for (const f of features) {
    if (f.value === null) {
      missing.push(f); // mentioned but value unknown → Tag Garden (H7)
      continue;
    }
    if (f.type === "value_adjust") {
      const rule = rules.find((r) => r.key === f.key);
      if (!rule) {
        missing.push(f); // no rule for this feature yet
        continue;
      }
      const { vp_delta_ratio, cap_applied } = rule.apply(f);
      adjustments.push({ key: f.key, vp_delta_ratio, rule_id: rule.rule_id, cap_applied });
    }
    // TODO(H8): f.type === "term" → route into NegotiationContext.term_space
  }

  return { adjustments, missing };
}
