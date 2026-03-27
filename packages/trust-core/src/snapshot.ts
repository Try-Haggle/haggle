import type { TrustInput, TrustSnapshot, TrustWeights, TrustScoreResult } from "./types.js";
import { computeTrustScore } from "./trust-score.js";
import { classifyColdStart } from "./cold-start.js";

// ---------------------------------------------------------------------------
// Snapshot creation
// ---------------------------------------------------------------------------

/**
 * Create a Trust Score snapshot for backtest storage.
 * Captures raw inputs + computed score at a point in time.
 */
export function createTrustSnapshot(
  user_id: string,
  input: TrustInput,
  trade_count: number,
  weights_version: string,
  now?: string,
): TrustSnapshot {
  const result = computeTrustScore(input, trade_count);
  return {
    user_id,
    snapshot_at: now ?? new Date().toISOString(),
    raw_inputs: { ...input },
    computed_score: result.score,
    cold_start: classifyColdStart(trade_count),
    weights_version,
    trade_count,
  };
}

// ---------------------------------------------------------------------------
// Backtest comparison
// ---------------------------------------------------------------------------

export interface BacktestComparison {
  user_id: string;
  old_score: number | null;
  new_score: number | null;
  delta: number | null;
  old_weights_version: string;
  new_weights_version: string;
}

/**
 * Compare a snapshot's original score against a recomputed score with new weights.
 */
export function backtestSnapshot(
  snapshot: TrustSnapshot,
  new_weights: TrustWeights,
  new_weights_version: string,
): BacktestComparison {
  const recomputed = computeTrustScore(
    snapshot.raw_inputs,
    snapshot.trade_count,
    new_weights,
    new_weights_version,
  );

  const delta =
    snapshot.computed_score !== null && recomputed.score !== null
      ? recomputed.score - snapshot.computed_score
      : null;

  return {
    user_id: snapshot.user_id,
    old_score: snapshot.computed_score,
    new_score: recomputed.score,
    delta,
    old_weights_version: snapshot.weights_version,
    new_weights_version,
  };
}

/**
 * Run backtest across multiple snapshots.
 * Returns per-user comparisons and aggregate statistics.
 */
export function backtestBatch(
  snapshots: TrustSnapshot[],
  new_weights: TrustWeights,
  new_weights_version: string,
): {
  comparisons: BacktestComparison[];
  stats: {
    total: number;
    scored: number;
    avg_delta: number;
    affected_5plus: number;
    affected_10plus: number;
  };
} {
  const comparisons = snapshots.map((s) =>
    backtestSnapshot(s, new_weights, new_weights_version),
  );

  const scored = comparisons.filter((c) => c.delta !== null);
  const deltas = scored.map((c) => c.delta!);
  const avg_delta =
    deltas.length > 0
      ? Math.round((deltas.reduce((s, d) => s + d, 0) / deltas.length) * 100) / 100
      : 0;

  return {
    comparisons,
    stats: {
      total: comparisons.length,
      scored: scored.length,
      avg_delta,
      affected_5plus: deltas.filter((d) => Math.abs(d) >= 5).length,
      affected_10plus: deltas.filter((d) => Math.abs(d) >= 10).length,
    },
  };
}
