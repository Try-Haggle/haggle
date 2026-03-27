import type { TrustInput, TrustWeights, TrustScoreResult } from "./types.js";
import { INVERTED_METRICS, TRUST_WEIGHTS_V1 } from "./types.js";
import { classifyColdStart } from "./cold-start.js";

// ---------------------------------------------------------------------------
// Weight redistribution
// ---------------------------------------------------------------------------

/**
 * Given raw inputs with possible nulls, redistribute weights so that
 * only inputs with data are considered and their weights sum to 1.0.
 *
 * Returns pairs of [normalized_value, redistributed_weight] for non-null inputs.
 */
export function redistributeWeights(
  input: TrustInput,
  weights: TrustWeights,
): { key: keyof TrustInput; value: number; weight: number }[] {
  const entries: { key: keyof TrustInput; value: number; weight: number }[] = [];

  for (const key of Object.keys(weights) as (keyof TrustInput)[]) {
    const raw = input[key];
    if (raw === null || raw === undefined) continue;

    // Invert "lower is better" metrics
    const normalized = INVERTED_METRICS.includes(key) ? 1 - raw : raw;
    entries.push({ key, value: normalized, weight: weights[key] });
  }

  if (entries.length === 0) return [];

  // Redistribute: scale weights so they sum to 1.0
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  return entries.map((e) => ({
    ...e,
    weight: e.weight / totalWeight,
  }));
}

// ---------------------------------------------------------------------------
// Trust Score computation
// ---------------------------------------------------------------------------

/**
 * Compute Trust Score from raw inputs.
 *
 * - Filters out null inputs
 * - Redistributes remaining weights to sum to 1.0
 * - Inverts "lower is better" metrics (dispute_incidence_rate, cancellation_rate)
 * - Weighted sum × 100 = raw score, clamped to [0, 100]
 * - Returns null score if user is in NEW cold start stage
 */
export function computeTrustScore(
  input: TrustInput,
  trade_count: number,
  weights: TrustWeights = TRUST_WEIGHTS_V1,
  weights_version: string = "v1",
): TrustScoreResult {
  const cold_start = classifyColdStart(trade_count);
  const totalInputs = Object.keys(weights).length;

  if (cold_start === "NEW") {
    return {
      score: null,
      cold_start,
      inputs_used: 0,
      inputs_total: totalInputs,
      weights_version,
    };
  }

  const entries = redistributeWeights(input, weights);

  if (entries.length === 0) {
    return {
      score: null,
      cold_start,
      inputs_used: 0,
      inputs_total: totalInputs,
      weights_version,
    };
  }

  const rawScore = entries.reduce((sum, e) => sum + e.value * e.weight, 0);
  const score = Math.round(Math.max(0, Math.min(100, rawScore * 100)));

  return {
    score,
    cold_start,
    inputs_used: entries.length,
    inputs_total: totalInputs,
    weights_version,
  };
}

/**
 * Recompute a score using different weights (for backtest).
 * Applies new weights to existing raw inputs.
 */
export function recomputeWithWeights(
  input: TrustInput,
  trade_count: number,
  new_weights: TrustWeights,
  weights_version: string,
): TrustScoreResult {
  return computeTrustScore(input, trade_count, new_weights, weights_version);
}
