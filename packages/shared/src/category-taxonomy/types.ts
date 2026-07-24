/**
 * Category taxonomy (TAX / Phase 1) — the "what to ask/check per category" backbone.
 *
 * NAICS-style hierarchy: broad category → subcategory → specific. Each node carries
 * the negotiation checks (questions + optional engine feature link) introduced at
 * that level; descendants inherit ancestors' checks. One source consumed by the
 * three LLM touchpoints (seller builder, buyer builder, negotiation runtime).
 */

export type CheckEnforcement = "hard" | "soft";

/** One thing worth asking / verifying for a category. */
export interface NegotiationCheck {
  /** Stable id, unique across the taxonomy. */
  id: string;
  /** Human question surfaced by the builders / point to verify in negotiation. */
  questionKo: string;
  /**
   * Links to an engine feature (a FEATURE_SCHEMA key in @haggle/engine-core) when
   * this check is priceable or gated. Referenced as a string to keep shared free of
   * an engine-core dependency; consistency is cross-checked in an app-level test.
   */
  featureKey?: string;
  enforcement: CheckEnforcement;
}

/** A node in the category hierarchy. */
export interface CategoryNode {
  /** Hierarchical tag path, e.g. "electronics/phones/iphone". */
  path: string;
  /** Extra tags/labels that also resolve to this node (brand names, synonyms). */
  aliases?: string[];
  /** Checks introduced at this node; inherited by descendants. */
  checks: NegotiationCheck[];
}
