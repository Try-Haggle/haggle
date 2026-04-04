import type {
  TrustInput,
  TrustResult,
  TrustStatus,
  TrustRole,
  TrustInputKey,
  ComputeOptions,
  WeightConfig,
  SlaPenalty,
} from "./types.js";
import {
  DEFAULT_WEIGHT_CONFIG,
  WEIGHTS_VERSION,
  getApplicableKeys,
  redistributeWeights,
} from "./weights.js";
import { normalizeInput } from "./normalize.js";

// ---------------------------------------------------------------------------
// Cold-start thresholds
// ---------------------------------------------------------------------------

/** Minimum completed transactions to start scoring. */
export const SCORING_THRESHOLD = 5;

/** Minimum completed transactions for mature status. */
export const MATURE_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// SLA penalty constants
// ---------------------------------------------------------------------------

/** Penalty per SLA violation (2% per violation). */
export const SLA_PENALTY_PER_VIOLATION = 0.02;

/** Maximum SLA penalty (20% reduction). */
export const SLA_PENALTY_MAX = 0.20;

// ---------------------------------------------------------------------------
// Status determination
// ---------------------------------------------------------------------------

/**
 * Determines the trust status based on completed transaction count.
 */
export function determineTrustStatus(completedTransactions: number): TrustStatus {
  if (completedTransactions < SCORING_THRESHOLD) return "NEW";
  if (completedTransactions < MATURE_THRESHOLD) return "SCORING";
  return "MATURE";
}

// ---------------------------------------------------------------------------
// SLA penalty factor
// ---------------------------------------------------------------------------

/**
 * Computes the SLA penalty factor.
 * Returns a multiplier in [0.8, 1.0] — 1.0 means no penalty.
 */
export function computeSlaPenaltyFactor(penalty?: SlaPenalty): number {
  if (!penalty || penalty.sla_violation_count <= 0) return 1.0;
  const reduction = Math.min(penalty.sla_violation_count * SLA_PENALTY_PER_VIOLATION, SLA_PENALTY_MAX);
  return 1 - reduction;
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Computes the trust score for a user.
 *
 * Pure function — no DB, API, or LLM dependencies.
 *
 * @param input - Raw trust input signals.
 * @param options - Computation options (role, completed transactions, SLA penalty, weight overrides).
 * @returns TrustResult with score, status, and metadata.
 */
export function computeTrustScore(
  input: TrustInput,
  options: ComputeOptions,
): TrustResult {
  const role: TrustRole = options.role ?? "combined";
  const config: WeightConfig = options.weights ?? DEFAULT_WEIGHT_CONFIG;
  const status = determineTrustStatus(options.completed_transactions);

  // If NEW (cold start), return score 0 with status
  if (status === "NEW") {
    return {
      score: 0,
      status,
      completed_transactions: options.completed_transactions,
      role,
      weights_version: WEIGHTS_VERSION,
      raw_score: 0,
      sla_penalty_factor: 1.0,
    };
  }

  // Get applicable keys for the role
  const applicableKeys = getApplicableKeys(config, role);

  // Determine which applicable keys have defined values
  const definedKeys = applicableKeys.filter(
    (key) => input[key] !== undefined && input[key] !== null,
  );

  // If no inputs are defined, score is 0
  if (definedKeys.length === 0) {
    return {
      score: 0,
      status,
      completed_transactions: options.completed_transactions,
      role,
      weights_version: WEIGHTS_VERSION,
      raw_score: 0,
      sla_penalty_factor: computeSlaPenaltyFactor(options.sla_penalty),
    };
  }

  // Redistribute weights among defined keys
  const weights = redistributeWeights(config, applicableKeys, definedKeys);

  // Compute weighted sum
  let weightedSum = 0;
  for (const key of definedKeys) {
    const rawValue = input[key] as number;
    const inputConfig = config[key];
    const normalizedValue = normalizeInput(rawValue, inputConfig.normalization);
    const weight = weights.get(key) ?? 0;
    weightedSum += normalizedValue * weight;
  }

  // Scale to 0-100 and clamp
  const rawScore = clamp(weightedSum * 100, 0, 100);

  // Apply SLA penalty
  const slaPenaltyFactor = computeSlaPenaltyFactor(options.sla_penalty);
  const finalScore = clamp(rawScore * slaPenaltyFactor, 0, 100);

  return {
    score: roundTo2(finalScore),
    status,
    completed_transactions: options.completed_transactions,
    role,
    weights_version: WEIGHTS_VERSION,
    raw_score: roundTo2(rawScore),
    sla_penalty_factor: slaPenaltyFactor,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}
