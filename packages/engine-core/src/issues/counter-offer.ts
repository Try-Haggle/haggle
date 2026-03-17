/**
 * Multi-Issue Counter-Offer Generator
 *
 * Instead of single-price Faratin, concedes across ALL negotiable issues
 * simultaneously using per-issue Faratin curves weighted by opponent model.
 *
 * Strategy:
 * 1. Compute target total utility U_target(t) via Faratin in utility space
 * 2. Distribute concession across issues proportionally
 * 3. Convert target per-issue utilities back to concrete values
 */

import { clamp } from '../utils.js';
import type {
  IssueDefinition,
  IssueValues,
  IssueWeight,
  IssueValue,
} from './types.js';
import { computeScalarUtility, computeEnumUtility } from './utility.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-issue concession parameters. */
export interface IssueFaratinParams {
  /** Issue definition from schema. */
  definition: IssueDefinition;
  /** Agent's ideal value (aspiration). */
  start_value: IssueValue;
  /** Agent's limit value (worst acceptable). */
  limit_value: IssueValue;
}

/** Input for multi-issue counter-offer generation. */
export interface MultiIssueCounterInput {
  /** Per-issue Faratin parameters. */
  issue_params: IssueFaratinParams[];
  /** Issue weights (same as utility computation). */
  weights: IssueWeight[];
  /** Time elapsed. */
  t: number;
  /** Total deadline. */
  T: number;
  /** Concession speed. Higher = slower concession. */
  beta: number;
  /** Previous offer values (for move cost). */
  previous_offer?: IssueValues;
}

/** Result of multi-issue counter-offer generation. */
export interface MultiIssueCounterResult {
  /** Proposed issue values. */
  values: IssueValues;
  /** Target utility level for this round. */
  u_target: number;
}

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

/**
 * Interpolate a scalar value between start and limit using concession ratio.
 * ratio = 0 → start_value, ratio = 1 → limit_value
 */
function interpolateScalar(
  start: number,
  limit: number,
  ratio: number,
): number {
  return start + (limit - start) * ratio;
}

/**
 * Interpolate an enum value by picking from ordered values based on concession ratio.
 * ratio = 0 → first value (best), ratio = 1 → last value (worst)
 */
function interpolateEnum(
  values: readonly string[],
  startIdx: number,
  limitIdx: number,
  ratio: number,
): string {
  const idx = Math.round(startIdx + (limitIdx - startIdx) * ratio);
  return values[clamp(idx, 0, values.length - 1)];
}

/**
 * Compute a counter-offer value for a single issue using Faratin concession.
 */
function computeIssueConcession(
  params: IssueFaratinParams,
  concessionRatio: number,
): IssueValue {
  const { definition, start_value, limit_value } = params;

  switch (definition.type) {
    case 'scalar':
    case 'deadline':
      return interpolateScalar(
        start_value as number,
        limit_value as number,
        concessionRatio,
      );

    case 'enum': {
      const values = definition.values ?? [];
      const startIdx = values.indexOf(start_value as string);
      const limitIdx = values.indexOf(limit_value as string);
      if (startIdx === -1 || limitIdx === -1) return start_value;
      return interpolateEnum(values, startIdx, limitIdx, concessionRatio);
    }

    case 'boolean':
      // Boolean: concede at ratio > 0.5
      return concessionRatio > 0.5 ? limit_value : start_value;

    default:
      return start_value;
  }
}

/**
 * Generate a multi-issue counter-offer.
 *
 * Uses Faratin time-dependent concession across all issues:
 * concession_ratio(t) = (t/T)^(1/β)
 *
 * All issues concede at the same rate. The overall utility target is:
 * U_target ≈ 1 - concession_ratio (approximate, since utility is weighted)
 */
export function computeMultiIssueCounterOffer(
  input: MultiIssueCounterInput,
): MultiIssueCounterResult {
  const { issue_params, t, T, beta } = input;

  // Guard: T=0 means no time left → full concession
  // Guard: beta=0 → step function (no concession until deadline, then full)
  let concessionRatio: number;
  if (T <= 0) {
    concessionRatio = 1;
  } else if (beta <= 0) {
    // beta=0: boulware extreme — no concession until deadline
    concessionRatio = t >= T ? 1 : 0;
  } else {
    const timeRatio = clamp(t / T, 0, 1);
    concessionRatio = Math.pow(timeRatio, 1 / beta);
  }

  const values: IssueValues = {};

  for (const params of issue_params) {
    values[params.definition.name] = computeIssueConcession(params, concessionRatio);
  }

  // Approximate target utility (exact requires re-computing multi-issue utility)
  const u_target = 1 - concessionRatio;

  return { values, u_target };
}

/**
 * Compute move cost between two offers.
 * Normalized sum of per-issue changes weighted by issue weights.
 */
export function computeMoveCost(
  current: IssueValues,
  previous: IssueValues,
  definitions: IssueDefinition[],
  weights: IssueWeight[],
): number {
  const weightMap = new Map(weights.map((w) => [w.issue_name, w.weight]));
  let totalCost = 0;

  for (const def of definitions) {
    const curr = current[def.name];
    const prev = previous[def.name];
    if (curr === undefined || prev === undefined) continue;

    const weight = weightMap.get(def.name) ?? 0;

    if (def.type === 'scalar' || def.type === 'deadline') {
      const range = (def.max ?? 1) - (def.min ?? 0);
      if (range > 0) {
        totalCost += weight * Math.abs((curr as number) - (prev as number)) / range;
      }
    } else if (def.type === 'enum') {
      // Binary: different = full cost
      totalCost += weight * (curr !== prev ? 1 : 0);
    } else if (def.type === 'boolean') {
      totalCost += weight * (curr !== prev ? 1 : 0);
    }
  }

  return totalCost;
}
