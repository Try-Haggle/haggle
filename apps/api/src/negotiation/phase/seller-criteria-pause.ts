/**
 * Seller-criteria PAUSE detector (Phase G, Flow 3).
 *
 * When the seller declared a REQUIRED category criterion for the item but the
 * buyer's agent never took a stance on it, the negotiation should pause and ask
 * the buyer before continuing — so the agent negotiates with a full picture of
 * the seller's non-negotiables. It compares the seller's declared-required criteria
 * against the buyer's answered criteria by check id (the structured, check-id-keyed
 * successor to the earlier taxonomy-hard shadow detector, now retired).
 *
 * Pure + deterministic (no DB/LLM). The executor reuses `persistHoldRound` to turn
 * a returned pause into a WAITING round carrying the question. Backward-compatible:
 * pre-Phase-G sessions carry no criteria, so `sellerRequired` is empty → never fires.
 */

import {
  type CategoryCriterion,
  criterionAnswered,
  unresolvedSellerRequirements,
} from "@haggle/shared";

export function isSellerCriteriaPauseReasoning(reasoning: unknown): boolean {
  return typeof reasoning === "string" && reasoning.includes(SELLER_CRITERIA_PAUSE_MARKER);
}

/** Unresolved seller-required asks still blocking a WAITING hold. */
export function unresolvedBuyerPauseAsks(snapshot: Record<string, unknown>): {
  checkId: string;
  ask: string;
}[] {
  const { sellerRequired, buyerCriteria } = readSellerCriteriaFromSnapshot(snapshot);
  return unresolvedSellerRequirements(sellerRequired, buyerCriteria)
    .map((c) => ({ checkId: c.checkId, ask: (c.buyerAskKo ?? c.questionKo)?.trim() ?? "" }))
    .filter((c): c is { checkId: string; ask: string } => Boolean(c.ask));
}

/**
 * Marker embedded in a seller-criteria hold's `reasoning` so the round loop can (a)
 * fire the pause at most once and (b) recognize a pending pause round and block the
 * auto-play loop on it until the buyer answers.
 */
export const SELLER_CRITERIA_PAUSE_MARKER = "SELLER_CRITERIA_PAUSE";

/**
 * Chat bubble for a seller-criteria HOLD. Pause questions belong in metadata /
 * the pause UI — not here. Otherwise the transcript replaces the counterpart
 * line (e.g. NEAR_DEAL $880) with IMEI/FRP/lock checklist text.
 */
export function sellerCriteriaHoldChatMessage(input: {
  incomingMessage?: string | null;
  incomingPriceMinor: number;
  senderRole: "BUYER" | "SELLER";
  pauseQuestions?: readonly string[];
  decision?: string | null;
}): string {
  // Never copy the incoming counterpart line (R2 seller text must not reappear as R3).
  // Pause questions belong in metadata / the pause UI, not the transcript bubble.
  void input.incomingMessage;
  void input.pauseQuestions;
  const dollars = (input.incomingPriceMinor / 100).toFixed(
    input.incomingPriceMinor % 100 === 0 ? 0 : 2,
  );
  const who = input.senderRole === "SELLER" ? "Seller" : "Buyer";
  if (input.decision === "NEAR_DEAL") {
    return `${who} signals near-deal at $${dollars}.`;
  }
  return `${who} is at $${dollars}.`;
}

export type BuyerPauseAsk = { checkId: string; ask: string };

export const BUYER_CRITERIA_REQUIRED = "BUYER_CRITERIA_REQUIRED";

/** True when the buyer has taken at least one non-blank stance. */
export function buyerHasAnsweredCriteria(buyerCriteria: readonly CategoryCriterion[]): boolean {
  return buyerCriteria.some(criterionAnswered);
}

/**
 * Start/play wizard-gate: seller required criteria exist and the buyer has not
 * answered any of them. Do not treat listing_context.seller_facts as answers.
 * Returns unresolved asks when play_next must reject — not a mid-session pause.
 */
export function buyerCriteriaStartGate(snapshot: Record<string, unknown>): BuyerPauseAsk[] {
  const { sellerRequired, buyerCriteria } = readSellerCriteriaFromSnapshot(snapshot);
  if (sellerRequired.length === 0) return [];
  if (buyerHasAnsweredCriteria(buyerCriteria)) return [];
  return unresolvedBuyerPauseAsks(snapshot);
}

/** Reject play_next / auto-play when the start wizard never answered seller required criteria. */
export function buyerCriteriaRequiredReject(snapshot: Record<string, unknown>): {
  error: typeof BUYER_CRITERIA_REQUIRED;
  message: string;
  required_check_ids: string[];
  required_criteria: BuyerPauseAsk[];
} | null {
  const asks = buyerCriteriaStartGate(snapshot);
  if (asks.length === 0) return null;
  return {
    error: BUYER_CRITERIA_REQUIRED,
    message:
      "Answer seller required criteria (IMEI/완납/침수/Find My) in the start wizard via buyerCriteria before play_next. Do not use answer_pause.",
    required_check_ids: asks.map((c) => c.checkId),
    required_criteria: asks,
  };
}

/**
 * Read the seller's REQUIRED criteria (injected at negotiation start) and the buyer's
 * own criteria off a responder snapshot. Both empty for pre-Phase-G sessions. Shared
 * by the executor pause gate and the auto-play resume handler.
 */
export function readSellerCriteriaFromSnapshot(snapshot: Record<string, unknown>): {
  sellerRequired: CategoryCriterion[];
  buyerCriteria: CategoryCriterion[];
} {
  const sellerRequired = Array.isArray(snapshot.pause_seller_required_criteria)
    ? (snapshot.pause_seller_required_criteria as CategoryCriterion[])
    : [];
  const buyerMemory = snapshot.buyer_negotiation_agent_builder_memory as
    | { categoryCriteria?: unknown }
    | undefined;
  const buyerCriteria = Array.isArray(buyerMemory?.categoryCriteria)
    ? (buyerMemory.categoryCriteria as CategoryCriterion[])
    : [];
  return { sellerRequired, buyerCriteria };
}

/**
 * Apply the buyer's mid-negotiation pause answer to their snapshot (Flow 3 resume):
 * write a stance for each unresolved seller-required check (explicit per-check stance
 * wins, else the single `fallback` answer). Returns the updated buyer snapshot and how
 * many stances were applied. Pure — the caller persists the result.
 */
export function applyBuyerPauseAnswer(
  buyerSnapshot: Record<string, unknown>,
  unresolved: readonly CategoryCriterion[],
  stanceByCheckId: ReadonlyMap<string, string>,
  fallback: string | undefined,
): { buyerSnapshot: Record<string, unknown>; applied: number } {
  const buyerMemory = (buyerSnapshot.buyer_negotiation_agent_builder_memory ?? {}) as Record<
    string,
    unknown
  >;
  const criteria = Array.isArray(buyerMemory.categoryCriteria)
    ? ([...buyerMemory.categoryCriteria] as CategoryCriterion[])
    : [];
  let applied = 0;
  for (const requirement of unresolved) {
    const raw = stanceByCheckId.get(requirement.checkId) ?? fallback;
    const stance = raw?.trim();
    if (!stance) continue;
    const idx = criteria.findIndex((c) => c.checkId === requirement.checkId);
    if (idx >= 0) {
      criteria[idx] = { ...criteria[idx]!, stance };
    } else {
      criteria.push({
        checkId: requirement.checkId,
        questionKo: requirement.questionKo,
        enforcement: requirement.enforcement,
        requirement: "required",
        stance,
        ...(requirement.buyerAskKo !== undefined ? { buyerAskKo: requirement.buyerAskKo } : {}),
      });
    }
    applied++;
  }
  return {
    buyerSnapshot: {
      ...buyerSnapshot,
      buyer_negotiation_agent_builder_memory: { ...buyerMemory, categoryCriteria: criteria },
    },
    applied,
  };
}

export interface SellerCriteriaPause {
  /** The buyer-facing question for the first unresolved seller requirement. */
  question: string;
  /** Buyer-facing questions for ALL unresolved requirements (first-listed first). */
  questions: string[];
  /** Short machine reason for logs / the held round's decision reasoning. */
  reason: string;
  /** All seller-required check ids the buyer has not addressed. */
  unresolvedCheckIds: string[];
}

export interface DetectSellerCriteriaPauseInput {
  /** The role responding this round. The pause only asks the BUYER. */
  responderRole: "buyer" | "seller";
  /** The seller's REQUIRED criteria for the item (from negotiation start). */
  sellerRequired: readonly CategoryCriterion[];
  /** The buyer's own criteria (their answered stances). */
  buyerCriteria: readonly CategoryCriterion[];
  /** The round about to run. */
  round: number;
  /** Earliest round the pause may fire (default 2 — round 1 is the opening). */
  minRound?: number;
}

/**
 * Decide whether to pause and ask the buyer about an unresolved seller requirement.
 * Returns null when nothing should pause (wrong side, too early, or all addressed).
 */
export function detectSellerCriteriaPause(
  input: DetectSellerCriteriaPauseInput,
): SellerCriteriaPause | null {
  const minRound = input.minRound ?? 2;
  // Only the buyer is asked; only after the opening; a finite round only.
  if (input.responderRole !== "buyer") return null;
  if (!Number.isFinite(input.round) || input.round < minRound) return null;
  if (input.sellerRequired.length === 0) return null;

  // Keep only criteria that yield a real buyer-facing question — guards against a
  // malformed required criterion missing both buyerAskKo and questionKo (so the hold
  // message can never become the literal string "undefined").
  const unresolved = unresolvedSellerRequirements(input.sellerRequired, input.buyerCriteria)
    .map((c) => ({ checkId: c.checkId, ask: (c.buyerAskKo ?? c.questionKo)?.trim() }))
    .filter((c): c is { checkId: string; ask: string } => Boolean(c.ask));
  if (unresolved.length === 0) return null;

  const first = unresolved[0]!;
  return {
    question: first.ask,
    questions: unresolved.map((c) => c.ask),
    reason: `seller requires "${first.checkId}" but the buyer has no stance on it`,
    unresolvedCheckIds: unresolved.map((c) => c.checkId),
  };
}
