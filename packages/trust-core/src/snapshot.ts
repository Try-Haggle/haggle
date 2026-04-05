import type { TrustInput, TrustSnapshot } from "./types.js";
import { WEIGHTS_VERSION } from "./weights.js";

// ---------------------------------------------------------------------------
// Snapshot creation
// ---------------------------------------------------------------------------

/**
 * Creates a trust snapshot for quarterly backtest purposes.
 *
 * @param userId - The user identifier.
 * @param snapshotDate - ISO date string (e.g. "2026-03-31").
 * @param rawInputs - The raw trust input signals at snapshot time.
 * @param computedScore - The computed trust score at snapshot time.
 * @param weightsVersion - Optional weights version override. Defaults to current WEIGHTS_VERSION.
 * @returns A TrustSnapshot with next_quarter_dispute defaulting to false.
 */
export function createSnapshot(
  userId: string,
  snapshotDate: string,
  rawInputs: TrustInput,
  computedScore: number,
  weightsVersion?: string,
): TrustSnapshot {
  return {
    user_id: userId,
    snapshot_date: snapshotDate,
    raw_inputs: { ...rawInputs },
    computed_score: computedScore,
    weights_version: weightsVersion ?? WEIGHTS_VERSION,
    next_quarter_dispute: false,
  };
}
