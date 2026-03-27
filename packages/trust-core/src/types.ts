// ---------------------------------------------------------------------------
// Trust Score — Types
// ---------------------------------------------------------------------------

/**
 * Raw input metrics for Trust Score computation.
 * null = data not available (buyer-only user has no SLA data, etc.)
 * All rates are 0-1 where 1 is best/most.
 */
export interface TrustInput {
  /** Completed trades / total initiated trades. Higher = better. */
  trade_completion_rate: number | null;

  /** Disputes where this user's side was Accepted / total disputes involving user. Higher = better. */
  dispute_win_rate: number | null;

  /** Disputes filed involving this user / total trades. Lower = better (inverted during computation). */
  dispute_incidence_rate: number | null;

  /** Shipments sent within SLA / total shipments (seller role only). Higher = better. */
  sla_compliance_rate: number | null;

  /** User-attributable cancellations / total trades. Lower = better (inverted during computation). */
  cancellation_rate: number | null;

  /** Auto-confirmed deliveries / total purchases (buyer role only). Higher = better. */
  auto_confirm_rate: number | null;

  /** Average peer rating normalized to 0-1 (e.g., 4.5/5 = 0.9). Higher = better. */
  peer_rating: number | null;

  /** Trade frequency normalized to 0-1 (relative to platform median). Higher = more active. */
  trade_frequency: number | null;

  /** Account age normalized to 0-1 (e.g., 365 days / max_days). Higher = longer tenure. */
  account_tenure: number | null;
}

/** Metrics that are "lower is better" — inverted during computation. */
export const INVERTED_METRICS: (keyof TrustInput)[] = [
  "dispute_incidence_rate",
  "cancellation_rate",
];

/**
 * Weight configuration for Trust Score.
 * Keys must match TrustInput. Values must sum to 1.0.
 */
export type TrustWeights = Record<keyof TrustInput, number>;

export const TRUST_WEIGHTS_V1: TrustWeights = {
  trade_completion_rate: 0.20,
  dispute_win_rate: 0.18,
  dispute_incidence_rate: 0.15,
  sla_compliance_rate: 0.12,
  cancellation_rate: 0.12,
  auto_confirm_rate: 0.08,
  peer_rating: 0.08,
  trade_frequency: 0.04,
  account_tenure: 0.03,
};

/** Cold start classification based on completed trade count. */
export type ColdStartStage = "NEW" | "SCORING" | "MATURE";

export const COLD_START_THRESHOLDS = {
  /** 0 to this (exclusive) = NEW — no score shown. */
  scoring_min: 5,
  /** This and above = MATURE — fully reliable score. */
  mature_min: 20,
} as const;

export interface TrustScoreResult {
  /** Final score 0-100. null if NEW stage. */
  score: number | null;
  cold_start: ColdStartStage;
  /** How many input metrics had data. */
  inputs_used: number;
  inputs_total: number;
  weights_version: string;
}

/**
 * Snapshot for backtest validation.
 * Stores raw inputs at a point in time so new weights can be retroactively applied.
 */
export interface TrustSnapshot {
  user_id: string;
  snapshot_at: string;
  raw_inputs: TrustInput;
  computed_score: number | null;
  cold_start: ColdStartStage;
  weights_version: string;
  trade_count: number;
}

// ---------------------------------------------------------------------------
// SLA Penalty
// ---------------------------------------------------------------------------

export const SLA_PENALTY_BASE = 5;

export const SLA_FREQUENCY_MULTIPLIERS: Record<string, number> = {
  first: 1.0,
  second_in_90d: 1.5,
  third_in_90d: 2.5,
  fourth_plus_in_90d: 4.0,
};

export interface SlaPenaltyInput {
  overdue_days: number;
  sla_days: number;
  violations_in_90d: number;
}

export interface SlaPenaltyResult {
  penalty: number;
  base: number;
  overdue_ratio: number;
  frequency_multiplier: number;
}
