/**
 * J(ω) Offer Search (Section 11.4)
 *
 * Optimizes a counter-offer by balancing:
 *   J(ω) = α · U_total(ω, c_t) + (1−α) · P̂_accept(ω | m_t) − η · C_move(ω, ω_prev)
 *
 * Uses grid search with ±5% perturbations around the base Faratin counter-offer.
 * Pure function, no side effects.
 */

import { clamp } from '../utils.js';
import type {
  IssueDefinition,
  IssueValues,
  IssueWeight,
  IssueValue,
  RiskCostParams,
  RelationshipBonusParams,
  MultiIssueUtilityResult,
} from './types.js';
import { computeMultiIssueUtility } from './utility.js';
import type { ContractUtilityInput } from './utility.js';
import { computeMoveCost } from './counter-offer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for the J(ω) offer search. */
export interface OfferSearchInput {
  /** Base counter-offer from Faratin concession. */
  base_offer: IssueValues;
  /** Issue definitions. */
  definitions: IssueDefinition[];
  /** Issue weights. */
  weights: IssueWeight[];
  /** Risk cost params (for utility recalculation). */
  risk: RiskCostParams;
  /** Relationship params. */
  relationship: RelationshipBonusParams;
  /** Opponent's last offer (for acceptance probability). */
  opponent_last_offer?: IssueValues;
  /** Previous own offer (for move cost). */
  previous_own_offer?: IssueValues;
  /** Self-utility weight α (default 0.7). */
  alpha?: number;
  /** Move cost penalty η (default 0.1). */
  eta?: number;
}

/** Result of the J(ω) offer search. */
export interface OfferSearchResult {
  /** The optimized offer values. */
  offer: IssueValues;
  /** The J(ω) score. */
  score: number;
  /** Breakdown of J(ω) components. */
  u_self: number;
  p_accept: number;
  move_cost: number;
}

// ---------------------------------------------------------------------------
// Perturbation constant
// ---------------------------------------------------------------------------

/** Perturbation ratio for grid search (±5%). */
const PERTURBATION_RATIO = 0.05;

// ---------------------------------------------------------------------------
// Acceptance probability estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the probability that the opponent will accept an offer.
 *
 * Heuristic: per-issue closeness to opponent's last position,
 * weighted by issue weights and normalized to [0, 1].
 *
 * If no opponent offer is available, returns 0.5 (maximum uncertainty).
 */
export function estimateAcceptanceProbability(
  offer: IssueValues,
  opponentLast: IssueValues | undefined,
  definitions: IssueDefinition[],
  weights: IssueWeight[],
): number {
  if (!opponentLast) return 0.5;

  const weightMap = new Map(weights.map((w) => [w.issue_name, w.weight]));
  let weightedCloseness = 0;
  let totalWeight = 0;

  for (const def of definitions) {
    if (def.category !== 'negotiable') continue;

    const ours = offer[def.name];
    const theirs = opponentLast[def.name];
    if (ours === undefined || theirs === undefined) continue;

    const weight = weightMap.get(def.name) ?? 0;
    if (weight <= 0) continue;

    let closeness: number;

    if (def.type === 'scalar' || def.type === 'deadline') {
      const range = (def.max ?? 1) - (def.min ?? 0);
      if (range <= 0) {
        closeness = 1;
      } else {
        const distance = Math.abs((ours as number) - (theirs as number));
        closeness = 1 - clamp(distance / range, 0, 1);
      }
    } else if (def.type === 'enum') {
      closeness = ours === theirs ? 1 : 0;
    } else if (def.type === 'boolean') {
      closeness = ours === theirs ? 1 : 0;
    } else {
      continue;
    }

    weightedCloseness += weight * closeness;
    totalWeight += weight;
  }

  if (totalWeight <= 0) return 0.5;
  return clamp(weightedCloseness / totalWeight, 0, 1);
}

// ---------------------------------------------------------------------------
// Score function
// ---------------------------------------------------------------------------

/**
 * Compute J(ω) for a single offer candidate.
 *
 * J(ω) = α · U_total(ω, c_t) + (1−α) · P̂_accept(ω | m_t) − η · C_move(ω, ω_prev)
 */
function scoreOffer(
  offer: IssueValues,
  input: OfferSearchInput,
): { score: number; u_self: number; p_accept: number; move_cost: number } {
  const alpha = input.alpha ?? 0.7;
  const eta = input.eta ?? 0.1;

  // Build utility input from the candidate offer
  const negotiableDefinitions = input.definitions.filter(
    (d) => d.category === 'negotiable',
  );
  const contractInput: ContractUtilityInput = {
    definitions: negotiableDefinitions,
    weights: input.weights,
    negotiable_values: offer,
  };

  const utilityResult: MultiIssueUtilityResult = computeMultiIssueUtility({
    contract: contractInput,
    risk: input.risk,
    relationship: input.relationship,
  });

  const u_self = utilityResult.u_total;

  const p_accept = estimateAcceptanceProbability(
    offer,
    input.opponent_last_offer,
    input.definitions,
    input.weights,
  );

  const move_cost = input.previous_own_offer
    ? computeMoveCost(offer, input.previous_own_offer, input.definitions, input.weights)
    : 0;

  const score = alpha * u_self + (1 - alpha) * p_accept - eta * move_cost;

  return { score, u_self, p_accept, move_cost };
}

// ---------------------------------------------------------------------------
// Perturbation generator
// ---------------------------------------------------------------------------

/**
 * Generate perturbed offers around the base offer.
 * For each scalar/deadline issue, create two variants: +5% and -5% of range.
 * Boolean and enum issues are not perturbed (discrete values, minimal gain).
 */
function generatePerturbations(
  base: IssueValues,
  definitions: IssueDefinition[],
): IssueValues[] {
  const perturbations: IssueValues[] = [];

  for (const def of definitions) {
    if (def.category !== 'negotiable') continue;
    if (def.type !== 'scalar' && def.type !== 'deadline') continue;

    const baseVal = base[def.name];
    if (baseVal === undefined || typeof baseVal !== 'number') continue;

    const range = (def.max ?? 1) - (def.min ?? 0);
    if (range <= 0) continue;

    const delta = range * PERTURBATION_RATIO;
    const minVal = def.min ?? 0;
    const maxVal = def.max ?? 1;

    // +delta perturbation
    const higher = clamp(baseVal + delta, minVal, maxVal);
    if (higher !== baseVal) {
      perturbations.push({ ...base, [def.name]: higher });
    }

    // -delta perturbation
    const lower = clamp(baseVal - delta, minVal, maxVal);
    if (lower !== baseVal) {
      perturbations.push({ ...base, [def.name]: lower });
    }
  }

  return perturbations;
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Search for an optimized offer by evaluating the base offer and perturbations.
 *
 * 1. Compute J(ω) for the base_offer.
 * 2. For each scalar/deadline issue, try ±5% perturbations.
 * 3. Return the offer with the highest J(ω).
 */
export function searchOffer(input: OfferSearchInput): OfferSearchResult {
  // Score the base offer
  const baseResult = scoreOffer(input.base_offer, input);
  let best: OfferSearchResult = {
    offer: input.base_offer,
    score: baseResult.score,
    u_self: baseResult.u_self,
    p_accept: baseResult.p_accept,
    move_cost: baseResult.move_cost,
  };

  // Generate and evaluate perturbations
  const perturbations = generatePerturbations(input.base_offer, input.definitions);

  for (const candidate of perturbations) {
    const result = scoreOffer(candidate, input);
    if (result.score > best.score) {
      best = {
        offer: candidate,
        score: result.score,
        u_self: result.u_self,
        p_accept: result.p_accept,
        move_cost: result.move_cost,
      };
    }
  }

  return best;
}
