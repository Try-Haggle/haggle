/**
 * Multi-Issue Utility Computation
 *
 * Implements the vNext utility model from the Unified Model Document (Section 11.2):
 *   U_contract(ω) = Σ w_i * v_i(x_i) + Σ w_j * v_j(z_j)
 *   C_risk(ω, c)  = λ_f * p_fraud + λ_q * p_quality + λ_d * p_delay + λ_s * p_dispute
 *   B_rel(c)       = ρ_1 * q_reputation + ρ_2 * q_repeat + ρ_3 * q_responsiveness
 *   U_total        = clip(U_contract - C_risk + B_rel, 0, 1)
 *
 * Pure functions, no side effects, no external dependencies.
 */

import { clamp } from '../utils.js';
import type {
  IssueDefinition,
  IssueValue,
  IssueValues,
  IssueWeight,
  IssueUtilityResult,
  MultiIssueUtilityResult,
  RiskCostParams,
  RelationshipBonusParams,
} from './types.js';

// ---------------------------------------------------------------------------
// Single-issue utility functions  v_i(x_i) → [0, 1]
// ---------------------------------------------------------------------------

/**
 * Compute utility for a scalar issue (e.g. price, warranty_days).
 * Uses linear interpolation between min/max bounds normalized by direction.
 *
 * lower_better: utility = (max - x) / (max - min)
 * higher_better: utility = (x - min) / (max - min)
 */
export function computeScalarUtility(
  value: number,
  def: IssueDefinition,
): number {
  const min = def.min ?? 0;
  const max = def.max ?? 1;
  const range = max - min;
  if (range <= 0) return 0;

  const clamped = clamp(value, min, max);

  if (def.direction === 'lower_better') {
    return (max - clamped) / range;
  }
  // higher_better (default)
  return (clamped - min) / range;
}

/**
 * Compute utility for a deadline issue (same math as scalar, semantically "lower_better").
 */
export function computeDeadlineUtility(
  value: number,
  def: IssueDefinition,
): number {
  return computeScalarUtility(value, { ...def, direction: def.direction ?? 'lower_better' });
}

/**
 * Compute utility for an enum issue.
 * Values are ordered from best (index 0) to worst (index N-1) or vice versa.
 * For "lower_better" direction: first value = best (utility 1.0).
 * For "higher_better" direction: last value = best (utility 1.0).
 */
export function computeEnumUtility(
  value: string,
  def: IssueDefinition,
): number {
  const values = def.values;
  if (!values || values.length === 0) return 0;

  const idx = values.indexOf(value);
  if (idx === -1) return 0;

  const n = values.length;
  if (n === 1) return 1;

  if (def.direction === 'higher_better') {
    return idx / (n - 1);
  }
  // lower_better: first is best
  return 1 - idx / (n - 1);
}

/**
 * Compute utility for a boolean issue.
 * true = 1.0 for higher_better, 0.0 for lower_better.
 */
export function computeBooleanUtility(
  value: boolean,
  def: IssueDefinition,
): number {
  if (def.direction === 'lower_better') {
    return value ? 0 : 1;
  }
  return value ? 1 : 0;
}

/**
 * Dispatch to the correct utility function based on issue type.
 */
export function computeIssueUtility(
  value: IssueValue,
  def: IssueDefinition,
): number {
  switch (def.type) {
    case 'scalar':
      return computeScalarUtility(value as number, def);
    case 'deadline':
      return computeDeadlineUtility(value as number, def);
    case 'enum':
      return computeEnumUtility(value as string, def);
    case 'boolean':
      return computeBooleanUtility(value as boolean, def);
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Contract Utility  U_contract = Σ w_i * v_i(x_i)
// ---------------------------------------------------------------------------

export interface ContractUtilityInput {
  /** Issue definitions (from schema). */
  definitions: IssueDefinition[];
  /** Weights per issue. Must cover all definitions. Sum to 1. */
  weights: IssueWeight[];
  /** Proposed issue values. */
  negotiable_values: IssueValues;
  /** Informational values (optional, contribute to utility). */
  informational_values?: IssueValues;
}

/**
 * Compute contract utility across all issues.
 * Returns per-issue breakdown + weighted total.
 *
 * Guards:
 * - Empty definitions → returns u_contract = 0
 * - Validates weight values are finite
 * - Runtime type guard: skips mismatched IssueValue types
 */
export function computeContractUtility(
  input: ContractUtilityInput,
): { issue_utilities: IssueUtilityResult[]; u_contract: number } {
  if (input.definitions.length === 0) {
    return { issue_utilities: [], u_contract: 0 };
  }

  const weightMap = new Map(input.weights.map((w) => [w.issue_name, w.weight]));
  const issue_utilities: IssueUtilityResult[] = [];
  let u_contract = 0;

  for (const def of input.definitions) {
    const value =
      def.category === 'informational'
        ? input.informational_values?.[def.name]
        : input.negotiable_values[def.name];

    if (value === undefined) continue;

    // Runtime type guard: skip mismatched types
    if (!isValidIssueValue(value, def)) continue;

    const utility = computeIssueUtility(value, def);
    const weight = weightMap.get(def.name) ?? 0;

    // Guard: non-finite weight
    if (!Number.isFinite(weight)) continue;

    issue_utilities.push({
      issue_name: def.name,
      raw_value: value,
      utility,
    });

    u_contract += weight * utility;
  }

  return { issue_utilities, u_contract };
}

/**
 * Runtime type guard: check if a value matches the expected IssueDefinition type.
 */
function isValidIssueValue(value: IssueValue, def: IssueDefinition): boolean {
  switch (def.type) {
    case 'scalar':
    case 'deadline':
      return typeof value === 'number' && Number.isFinite(value);
    case 'enum':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Risk Cost  C_risk = λ_f * p_fraud + λ_q * p_quality + λ_d * p_delay + λ_s * p_dispute
// ---------------------------------------------------------------------------

/**
 * Compute risk cost.
 */
export function computeRiskCost(params: RiskCostParams): number {
  return (
    params.lambda_f * params.p_fraud +
    params.lambda_q * params.p_quality +
    params.lambda_d * params.p_delay +
    params.lambda_s * params.p_dispute
  );
}

// ---------------------------------------------------------------------------
// Relationship Bonus  B_rel = ρ_1 * q_rep + ρ_2 * q_repeat + ρ_3 * q_responsiveness
// ---------------------------------------------------------------------------

/**
 * Compute relationship bonus.
 */
export function computeRelationshipBonus(params: RelationshipBonusParams): number {
  return (
    params.rho_1 * params.q_reputation +
    params.rho_2 * params.q_repeat +
    params.rho_3 * params.q_responsiveness
  );
}

// ---------------------------------------------------------------------------
// Total Utility  U_total = clip(U_contract - C_risk + B_rel, 0, 1)
// ---------------------------------------------------------------------------

export interface MultiIssueUtilityInput {
  contract: ContractUtilityInput;
  risk: RiskCostParams;
  relationship: RelationshipBonusParams;
}

/**
 * Compute total multi-issue utility.
 * U_total = clip(U_contract - C_risk + B_rel, 0, 1)
 */
export function computeMultiIssueUtility(
  input: MultiIssueUtilityInput,
): MultiIssueUtilityResult {
  const { issue_utilities, u_contract } = computeContractUtility(input.contract);
  const c_risk = computeRiskCost(input.risk);
  const b_rel = computeRelationshipBonus(input.relationship);
  const u_total = clamp(u_contract - c_risk + b_rel, 0, 1);

  return {
    issue_utilities,
    u_contract,
    c_risk,
    b_rel,
    u_total,
  };
}
