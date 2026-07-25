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
  /**
   * Verification-framed question — "is X true?" — for the negotiation RUNTIME and the
   * SELLER (the party who can state the fact). e.g. "명의가 명확한가요?".
   */
  questionKo: string;
  /**
   * Requirement-framed question for the BUYER agent-builder — "do you require X?".
   * The buyer cannot state a fact about the seller's item, so the builder must elicit
   * the buyer's PREFERENCE (which the agent later verifies with the seller). e.g.
   * "명의가 깨끗한 매물만 볼까요?". Consumers surfacing a check to the buyer should
   * prefer this and fall back to `questionKo` when absent.
   */
  buyerAskKo?: string;
  /**
   * Links to an engine feature (a FEATURE_SCHEMA key in @haggle/engine-core) when
   * this check is priceable or gated. Referenced as a string to keep shared free of
   * an engine-core dependency; consistency is cross-checked in an app-level test.
   */
  featureKey?: string;
  enforcement: CheckEnforcement;
  /**
   * Keywords/phrases that indicate this check has been ADDRESSED in a buyer's stated
   * requirements (e.g. "명의", "정품", "imei"). Consumers use these to decide when a
   * hard check is satisfied — without them a hard check has no satisfaction path and
   * would wedge a requirement flow into infinite re-asking. Required for any check
   * that a consumer promotes to a blocking/hard slot.
   */
  answerHints?: string[];
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
