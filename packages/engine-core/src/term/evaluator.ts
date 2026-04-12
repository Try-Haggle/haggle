/**
 * Multi-term utility evaluation.
 *
 * Evaluates a TermSpace into a single utility score [0,1]
 * by applying domain-based logarithmic utility for NEGOTIABLE terms
 * and direct value pass-through for INFORMATIONAL terms.
 */

import type { Term, TermSpace } from './types.js';
import { EngineError } from '../types.js';
import { clamp } from '../utils.js';

/**
 * Validate a TermSpace for structural correctness.
 * Returns null if valid, EngineError if invalid.
 */
export function validateTermSpace(termSpace: TermSpace): EngineError | null {
  const { terms } = termSpace;

  if (terms.length === 0) return EngineError.INVALID_WEIGHTS;

  for (const term of terms) {
    if (term.type === 'NEGOTIABLE' && !term.domain) {
      return EngineError.INVALID_WEIGHTS;
    }
    if (term.type === 'INFORMATIONAL' && term.domain) {
      return EngineError.INVALID_WEIGHTS;
    }
    if (term.weight < 0) {
      return EngineError.INVALID_WEIGHTS;
    }
    if (term.domain) {
      if (term.domain.min >= term.domain.max) {
        return EngineError.ZERO_PRICE_RANGE;
      }
    }
  }

  // NEGOTIABLE weights should sum to ~1.0
  const negotiableWeightSum = terms
    .filter(t => t.type === 'NEGOTIABLE')
    .reduce((sum, t) => sum + t.weight, 0);

  if (negotiableWeightSum > 0 && Math.abs(negotiableWeightSum - 1.0) > 1e-6) {
    return EngineError.INVALID_WEIGHTS;
  }

  return null;
}

/**
 * Evaluate a single term's utility contribution.
 *
 * NEGOTIABLE: logarithmic utility based on domain range (same V_p formula).
 * INFORMATIONAL: currentValue used directly, clamped to [0,1].
 */
export function evaluateTerm(term: Term, currentValue: number): number {
  if (term.type === 'INFORMATIONAL') {
    return clamp(currentValue, 0, 1);
  }

  // NEGOTIABLE — apply log utility with domain
  const domain = term.domain!;
  const range = domain.max - domain.min;
  if (range <= 0) return 0;

  if (domain.direction === 'lower_is_better') {
    // Like a buyer: lower currentValue is better.
    // V = 0 when currentValue >= max
    if (currentValue >= domain.max) return 0;
    const diff = domain.max - currentValue;
    const maxDiff = domain.max - domain.min;
    return clamp(Math.log(diff + 1) / Math.log(maxDiff + 1), 0, 1);
  } else {
    // higher_is_better — like a seller: higher currentValue is better.
    // V = 0 when currentValue <= min
    if (currentValue <= domain.min) return 0;
    const diff = currentValue - domain.min;
    const maxDiff = domain.max - domain.min;
    return clamp(Math.log(diff + 1) / Math.log(maxDiff + 1), 0, 1);
  }
}

/**
 * Compute aggregate multi-term utility.
 *
 * Weighted sum of NEGOTIABLE term utilities + average of INFORMATIONAL term
 * contributions as a secondary signal (scaled by 0.1 to avoid dominance).
 */
export function computeMultiTermUtility(termSpace: TermSpace): number {
  const { terms, current_values } = termSpace;

  let weightedSum = 0;
  let infoSum = 0;
  let infoCount = 0;

  for (const term of terms) {
    const value = current_values[term.id] ?? 0;
    const u = evaluateTerm(term, value);

    if (term.type === 'NEGOTIABLE') {
      weightedSum += term.weight * u;
    } else {
      infoSum += u;
      infoCount++;
    }
  }

  // INFORMATIONAL terms contribute a small bonus (max 0.1)
  const infoBonus = infoCount > 0 ? 0.1 * (infoSum / infoCount) : 0;

  return clamp(weightedSum + infoBonus, 0, 1);
}
