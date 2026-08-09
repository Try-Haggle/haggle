/**
 * Category taxonomy (TAX / Phase 1) — the "what to ask/check per category" backbone.
 *
 * NAICS-style hierarchy: broad category → subcategory → specific. Each node carries
 * the negotiation checks (questions + optional engine feature link) introduced at
 * that level; descendants inherit ancestors' checks. One source consumed by the
 * three LLM touchpoints (seller builder, buyer builder, negotiation runtime).
 */

export type CheckEnforcement = "hard" | "soft";

/**
 * A tappable, canonical answer to a check's buyer question — the "multiple choice"
 * layer (④/① in the feedback: pick-don't-type UX, applied deterministically without
 * an LLM turn). Choosing an option writes `stance` + `requirement` straight onto the
 * buyer's `CategoryCriterion`, so a known-category question needs zero API round-trip.
 */
export interface CheckAnswerOption {
  /** Short label the buyer taps (English, matching `buyerAskKo`). */
  label: string;
  /** Canonical stance stored on the criterion when this option is chosen. */
  stance: string;
  /**
   * What choosing this implies for the requirement: "required" = the buyer insists
   * on it (drives the mid-negotiation PAUSE gate), "optional" = a preference / waiver.
   * (Same union as `CriterionRequirement` in criteria.ts — kept as a literal here to
   * avoid a types→criteria import cycle.)
   */
  requirement: "required" | "optional";
}

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
  /**
   * Canonical tappable answers to `buyerAskKo` (BUYER side). Present only for checks
   * whose answer space is small and enumerable (deal-breaker yes/no, a few ranges).
   * When present, the buyer builder renders a multiple-choice picker and applies the
   * pick deterministically (no LLM turn); absent → the check stays free-text/LLM-driven.
   */
  answerOptions?: CheckAnswerOption[];
  /**
   * Short ENGLISH question shown to the SELLER for this check's quick-setup picker
   * (e.g. "What's the title status?"). `questionKo` is Korean/verification-framed, so
   * the English seller UI needs its own label. Present alongside `sellerOptions`.
   */
  sellerAsk?: string;
  /**
   * Canonical tappable answers for the SELLER (they state the item's fact — "clean
   * title" vs "salvage"). Lets the seller builder open INSTANTLY with a deterministic
   * picker instead of a slow LLM turn. Absent → the seller states it free-text.
   */
  sellerOptions?: CheckAnswerOption[];
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
