/**
 * Category criteria (Phase G — deterministic layer of the 2-layer hybrid).
 *
 * A `CategoryCriterion` is a per-item negotiation criterion keyed to a taxonomy
 * `NegotiationCheck.id`. This structured, check-id-keyed record is what connects
 * the three LLM touchpoints deterministically:
 *   - Flow 1 (seller builder): the seller declares which category checks are
 *     REQUIRED (deal-breakers they insist on) vs OPTIONAL (nice-to-have / leverage)
 *     and states their stance.
 *   - Flow 2 (buyer builder): the seller's REQUIRED criteria are surfaced so the
 *     buyer can mirror them (set their own stance), keyed by the same check id.
 *   - Flow 3 (negotiation runtime): a seller-required criterion the buyer never
 *     addressed is detected by check-id set difference → PAUSE and ask the buyer.
 *
 * Free-text buckets (mustHave / dealBreakers / mustEmphasize) still carry the
 * LLM long-tail (generative layer) — criteria here cover only taxonomy checks,
 * where a stable id makes mirroring and pause-matching exact rather than fuzzy.
 */

import { CATEGORY_TAXONOMY, resolveChecks } from "./taxonomy.js";
import type { CheckAnswerOption, CheckEnforcement } from "./types.js";

/** Whether a party has made a criterion a hard requirement or an optional point. */
export type CriterionRequirement = "required" | "optional";

/** One per-item negotiation criterion, keyed to a taxonomy check id. */
export interface CategoryCriterion {
  /** The taxonomy `NegotiationCheck.id` this criterion tracks. */
  checkId: string;
  /** Verification-framed question (runtime/seller) — mirror of the check. */
  questionKo: string;
  /** Requirement-framed question (buyer) — present when the check defines one. */
  buyerAskKo?: string;
  /** The category's native hard/soft enforcement for this check. */
  enforcement: CheckEnforcement;
  /**
   * Whether THIS party has made the criterion required (a hard gate they insist
   * on) or optional (nice-to-have / leverage). Defaults from `enforcement` in the
   * scaffold; the builder LLM confirms/edits it from the conversation.
   */
  requirement: CriterionRequirement;
  /**
   * The party's stated stance/answer (free text). Seller: the fact/position
   * ("clean title, verified"). Buyer: their preference ("clean-title only").
   * Absent/blank = not yet answered — which, for a seller REQUIRED criterion,
   * drives the mid-negotiation PAUSE.
   */
  stance?: string;
}

/**
 * Build criterion templates for an item's tags from the taxonomy checks. Each
 * resolved check becomes a criterion whose `requirement` defaults from its
 * enforcement (hard→required, soft→optional) with no stance yet. The builder
 * fills stance and may adjust requirement from what the party actually says.
 */
export function buildCategoryCriteriaScaffold(tags: readonly string[]): CategoryCriterion[] {
  return resolveChecks(tags).map((check) => {
    const criterion: CategoryCriterion = {
      checkId: check.id,
      questionKo: check.questionKo,
      enforcement: check.enforcement,
      requirement: check.enforcement === "hard" ? "required" : "optional",
    };
    if (check.buyerAskKo !== undefined) criterion.buyerAskKo = check.buyerAskKo;
    return criterion;
  });
}

/** Whether a criterion has been answered (a non-empty, non-blank stance). */
export function criterionAnswered(criterion: CategoryCriterion): boolean {
  return typeof criterion.stance === "string" && criterion.stance.trim().length > 0;
}

/**
 * The party's REQUIRED criteria — the subset a seller exposes to the buyer
 * (Flow 2) and the must-resolve set for PAUSE (Flow 3). Deduped by check id
 * (first occurrence wins), so a malformed doubled entry can't inflate the set.
 */
export function requiredCriteria(criteria: readonly CategoryCriterion[]): CategoryCriterion[] {
  const seen = new Set<string>();
  const out: CategoryCriterion[] = [];
  for (const criterion of criteria) {
    if (criterion.requirement !== "required") continue;
    if (seen.has(criterion.checkId)) continue;
    seen.add(criterion.checkId);
    out.push(criterion);
  }
  return out;
}

/**
 * The seller's REQUIRED criteria that the buyer has NOT addressed — i.e. the
 * seller insists on a check the buyer's criteria neither answered nor mirrored.
 * This is the must-ask set the mid-negotiation PAUSE surfaces to the buyer.
 * A buyer criterion counts as "addressed" once it carries a non-blank stance
 * (mirroring the seller's requirement, or explicitly waving it off).
 */
export function unresolvedSellerRequirements(
  sellerCriteria: readonly CategoryCriterion[],
  buyerCriteria: readonly CategoryCriterion[],
): CategoryCriterion[] {
  const buyerAddressed = new Set(
    buyerCriteria.filter(criterionAnswered).map((criterion) => criterion.checkId),
  );
  return requiredCriteria(sellerCriteria).filter(
    (criterion) => !buyerAddressed.has(criterion.checkId),
  );
}

/** A category check surfaced as a tappable multiple-choice question (buyer or seller). */
export interface CategoryChoiceQuestion {
  /** The taxonomy check id this question answers. */
  checkId: string;
  /** The side-appropriate display question (buyer: buyerAskKo; seller: sellerAsk). */
  question: string;
  /** Verification-framed question — carried so a chosen answer builds a full criterion. */
  questionKo: string;
  /** Buyer requirement-framed question — carried so the criterion keeps its buyer ask. */
  buyerAskKo?: string;
  enforcement: CheckEnforcement;
  /** Canonical tappable answers — choosing one sets stance + requirement deterministically. */
  options: CheckAnswerOption[];
}

/**
 * The item's taxonomy checks that carry a canonical multiple-choice answer set,
 * framed for the BUYER. Fully deterministic (no LLM): drives the pick-don't-type UI
 * and lets a known-category question be answered with zero API round-trip. Deduped by
 * check id (first occurrence wins). Checks without `answerOptions` stay free-text.
 */
export function buildBuyerChoiceQuestions(tags: readonly string[]): CategoryChoiceQuestion[] {
  const seen = new Set<string>();
  const out: CategoryChoiceQuestion[] = [];
  for (const check of resolveChecks(tags)) {
    if (!check.answerOptions?.length) continue;
    if (seen.has(check.id)) continue;
    seen.add(check.id);
    out.push({
      checkId: check.id,
      question: check.buyerAskKo ?? check.questionKo,
      questionKo: check.questionKo,
      buyerAskKo: check.buyerAskKo,
      enforcement: check.enforcement,
      options: check.answerOptions,
    });
  }
  return sortHardFirst(out);
}

/**
 * Stable sort putting HARD (deal-breaker) questions first, preserving taxonomy order
 * within each group. Deal-breakers are the most decision-relevant, so the quick-setup
 * picker leads with them (most-important-first scanning).
 */
function sortHardFirst(questions: CategoryChoiceQuestion[]): CategoryChoiceQuestion[] {
  return questions
    .map((q, i) => ({ q, i }))
    .sort((a, b) => {
      const rank = (e: CheckEnforcement) => (e === "hard" ? 0 : 1);
      return rank(a.q.enforcement) - rank(b.q.enforcement) || a.i - b.i;
    })
    .map((x) => x.q);
}

/**
 * The item's taxonomy checks with a canonical multiple-choice answer set framed for
 * the SELLER (they state the item's fact — "clean title" vs "salvage"). Deterministic
 * (no LLM), so the seller builder can open INSTANTLY instead of waiting on an LLM turn.
 * Deduped by check id. Checks without `sellerOptions` stay free-text.
 */
export function buildSellerChoiceQuestions(tags: readonly string[]): CategoryChoiceQuestion[] {
  const seen = new Set<string>();
  const out: CategoryChoiceQuestion[] = [];
  for (const check of resolveChecks(tags)) {
    if (!check.sellerOptions?.length) continue;
    if (seen.has(check.id)) continue;
    seen.add(check.id);
    out.push({
      checkId: check.id,
      question: check.sellerAsk ?? check.questionKo,
      questionKo: check.questionKo,
      buyerAskKo: check.buyerAskKo,
      enforcement: check.enforcement,
      options: check.sellerOptions,
    });
  }
  return sortHardFirst(out);
}

/**
 * Re-resolve a buyer's multiple-choice pick to its CANONICAL option from the taxonomy,
 * by check id + option label. Available for a server-side integrity path where only the
 * tapped option id is trusted and the authoritative stance/requirement come from here.
 * (The current builder applies picks client-side; /negotiations/start independently
 * sanitizes buyer categoryCriteria against the listing scaffold.) Returns undefined for
 * an unknown check id or label.
 */
export function resolveBuyerChoiceOption(
  tags: readonly string[],
  checkId: string,
  optionLabel: string,
): CheckAnswerOption | undefined {
  const question = buildBuyerChoiceQuestions(tags).find((q) => q.checkId === checkId);
  return question?.options.find((o) => o.label === optionLabel);
}

/**
 * The canonical tappable answers for a check, found by id alone.
 *
 * The mid-negotiation PAUSE knows only the check ids it is blocked on — the listing's
 * tags are not at hand — so it cannot use `buildBuyerChoiceQuestions`. Without this the
 * buyer is left typing free text at questions that have exact answers, and the stance
 * recorded never matches the one Quick Setup would have produced for the same check.
 *
 * Check ids are unique across the taxonomy in practice; first match wins, matching how
 * the choice builders dedupe.
 */
export function buyerChoiceOptionsForCheck(checkId: string): CheckAnswerOption[] {
  for (const node of CATEGORY_TAXONOMY) {
    for (const check of node.checks ?? []) {
      if (check.id === checkId) return check.answerOptions ?? [];
    }
  }
  return [];
}
