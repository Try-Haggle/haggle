/**
 * Feature schema (H4) — the vocabulary of features the engine understands.
 *
 * This is the "what can be talked about" registry that sits between the sensor
 * (L3, signal → ExtractedFeature) and the rules (L5, feature → bounded effect):
 *
 *   - The SENSOR (H5/L3) may only emit keys that appear here; anything else is
 *     dropped (auditable determinism).
 *   - The RULES (H6/L5) attach a bounded numeric effect to each `value_adjust`
 *     key. This file deliberately carries NO numeric effect/cap — those are the
 *     rules' job.
 *
 * Pure data. No I/O, no engine-core → app dependency (categories are plain tag
 * strings). Enum values here are provisional and will be reconciled with the
 * app-side term catalog (standard-terms.ts) during L4 / HAGGLE-9-B.
 */

import type { FeatureRouting } from "./types.js";

export type FeatureValueType = "number" | "enum" | "boolean";

/** For `term`-routed features: a negotiable term vs an informational gate (e.g. IMEI). */
export type TermKind = "negotiable" | "informational";

/** One entry in the feature vocabulary. */
export interface FeatureDef {
  /** Stable key the sensor emits and rules key off of, e.g. "battery_health". */
  key: string;
  /** Where the feature routes in the engine. */
  routing: FeatureRouting;
  /**
   * Scope where the feature is meaningful. `"*"` = universal, otherwise a tag-path
   * prefix (matched the same way as skill categoryTags), e.g. "electronics/phones".
   */
  category: string;
  valueType: FeatureValueType;
  /** Present for numeric features, e.g. "%". */
  unit?: string;
  /** Present for enum features (allowed values). */
  enumValues?: readonly string[];
  /** Required when `routing === "term"`; omit for value_adjust. */
  termKind?: TermKind;
  description: string;
}

/**
 * The initial, phones-first vocabulary. Universal features (`category: "*"`) apply
 * to every listing; category-scoped ones only attach where the category matches.
 */
export const FEATURE_SCHEMA: readonly FeatureDef[] = [
  // ── value_adjust: affects the price the engine is willing to accept ──
  {
    key: "battery_health",
    routing: "value_adjust",
    category: "electronics/phones",
    valueType: "number",
    unit: "%",
    description: "Battery health percentage; lower health lowers value.",
  },
  {
    key: "storage_capacity",
    routing: "value_adjust",
    category: "electronics/phones",
    valueType: "enum",
    enumValues: ["64GB", "128GB", "256GB", "512GB", "1TB"],
    description: "Onboard storage; higher capacity raises value.",
  },
  {
    key: "carrier_lock",
    routing: "value_adjust",
    category: "electronics/phones",
    valueType: "enum",
    enumValues: ["unlocked", "locked"],
    description: "Carrier lock status; a locked device is worth less.",
  },
  {
    key: "cosmetic_grade",
    routing: "value_adjust",
    category: "*",
    valueType: "enum",
    enumValues: ["mint", "excellent", "good", "fair", "poor"],
    description: "Overall cosmetic condition; worse grades lower value.",
  },
  {
    key: "original_accessories",
    routing: "value_adjust",
    category: "*",
    valueType: "boolean",
    description: "Whether original box/accessories are included; present raises value.",
  },

  // ── term (informational gate): must be resolved, not priced ──
  {
    key: "imei_verification",
    routing: "term",
    termKind: "informational",
    category: "electronics/phones",
    valueType: "boolean",
    description: "IMEI verified clean (not blacklisted/stolen). A gate, not a price lever.",
  },
  {
    key: "find_my_status",
    routing: "term",
    termKind: "informational",
    category: "electronics/phones",
    valueType: "boolean",
    description: "Find My / activation lock disabled. A gate, not a price lever.",
  },

  // ── term (negotiable): non-price conditions that can be traded ──
  {
    key: "shipping_method",
    routing: "term",
    termKind: "negotiable",
    category: "*",
    valueType: "enum",
    enumValues: ["shipped", "local_pickup"],
    description: "How the item changes hands.",
  },
  {
    key: "shipping_cost_split",
    routing: "term",
    termKind: "negotiable",
    category: "*",
    valueType: "enum",
    enumValues: ["buyer_pays", "seller_pays", "split"],
    description: "Who covers shipping cost.",
  },
  {
    key: "warranty_period",
    routing: "term",
    termKind: "negotiable",
    category: "*",
    valueType: "enum",
    enumValues: ["none", "30d", "90d", "1y"],
    description: "Warranty coverage offered with the item.",
  },
  {
    key: "return_policy",
    routing: "term",
    termKind: "negotiable",
    category: "*",
    valueType: "enum",
    enumValues: ["no_returns", "7d", "14d", "30d"],
    description: "Return window offered to the buyer.",
  },
];

const BY_KEY: ReadonlyMap<string, FeatureDef> = new Map(FEATURE_SCHEMA.map((f) => [f.key, f]));

/** Look up a feature definition by key. */
export function getFeatureDef(key: string): FeatureDef | undefined {
  return BY_KEY.get(key);
}

/** Whether a key is part of the schema (sensor output must satisfy this). */
export function isKnownFeatureKey(key: string): boolean {
  return BY_KEY.has(key);
}
