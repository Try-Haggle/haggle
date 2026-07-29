/**
 * Feature contract — the seam between the sensor (LLM extraction, API layer) and the
 * deterministic engine. A feature is "what was mentioned" (raw perception); the engine
 * decides "how much it's worth" via bounded, category-specific rules.
 *
 * Backlog: H4 (schema) / H5 (sensor) / H6 (apply). The types here are the kickoff
 * contract both tracks build against.
 */

/** Where an extracted feature routes. `gate` (e.g. IMEI) is folded into `term` as an
 *  INFORMATIONAL term, so there are only two buckets. */
export type FeatureRouting = "value_adjust" | "term";

/**
 * A structured signal extracted from the counterparty's natural-language message.
 * Produced by the sensor (Stage 1 Understand, H5). Only schema-defined keys survive;
 * anything not in the H4 schema is dropped (auditable determinism).
 */
export interface ExtractedFeature {
  /** Schema-defined key only, e.g. "battery_health". */
  key: string;
  type: FeatureRouting;
  /** Extracted value. `null` = mentioned but value unknown → feeds Tag Garden (H7). */
  value: number | string | boolean | null;
  unit?: string;
  source: "buyer_msg" | "seller_msg";
  /** Original text span, kept for audit. */
  raw_span?: string;
}

/** A bounded, deterministic adjustment the engine derived from one feature. */
export interface FeatureAdjustment {
  key: string;
  /** For value_adjust: signed ratio applied to V_p, already clamped by the rule. */
  vp_delta_ratio?: number;
  /** Which category rule produced this (audit). */
  rule_id: string;
  /** True if the rule's bound clamped the raw effect (audit). */
  cap_applied: boolean;
}

/** Result of applying features against category rules. */
export interface FeatureApplication {
  adjustments: FeatureAdjustment[];
  /** Features with unknown value or no matching rule → ask the missing side (H7). */
  missing: ExtractedFeature[];
}

/**
 * A category-specific rule mapping a feature to a bounded numeric effect.
 * Owned by the category skill (H9). `apply` MUST be deterministic and clamp its own
 * output — the engine trusts the rule to have already bounded the effect.
 */
export interface CategoryFeatureRule {
  category: string;
  key: string;
  rule_id: string;
  /** Returns the V_p delta ratio (signed, already clamped) for a value_adjust feature. */
  apply(feature: ExtractedFeature): { vp_delta_ratio: number; cap_applied: boolean };
}
