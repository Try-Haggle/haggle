import { type CategoryCriterion, criterionAnswered } from "@haggle/shared";

/** A seller-stated item fact, projected from one answered category criterion. */
export interface SellerItemFact {
  checkId: string;
  question: string;
  stance: string;
}

/** Snapshot bloat guards: the DECIDE prompt renders every fact each round. */
export const SELLER_FACTS_MAX_COUNT = 24;
export const SELLER_FACT_STANCE_MAX_LENGTH = 160;

/**
 * Project the seller's ANSWERED category criteria into shareable item facts
 * (battery %, storage, scratches, …). These are answers to buyer-facing
 * questions — not strategy — so they are deliberately surfaced to BOTH sides
 * via `listing_context.seller_facts`: without this the buyer's agent never
 * learns soft facts and can't use them as price leverage. Only the per-check
 * stance is shared; every other seller memory field (floor, tactics, tone)
 * stays private. Dedupes by check id (first wins) and caps count and stance
 * length.
 */
export function projectSellerFacts(
  criteria: readonly CategoryCriterion[] | undefined,
): SellerItemFact[] {
  const byId = new Map<string, SellerItemFact>();
  for (const c of criteria ?? []) {
    if (!criterionAnswered(c) || byId.has(c.checkId)) continue;
    if (byId.size >= SELLER_FACTS_MAX_COUNT) break;
    byId.set(c.checkId, {
      checkId: c.checkId,
      question: c.questionKo,
      stance: (c.stance as string).trim().slice(0, SELLER_FACT_STANCE_MAX_LENGTH),
    });
  }
  return [...byId.values()];
}
