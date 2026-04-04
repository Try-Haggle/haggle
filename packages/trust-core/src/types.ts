// ---------------------------------------------------------------------------
// Trust Input
// ---------------------------------------------------------------------------

/**
 * Raw input signals for trust score computation.
 * All rate fields are 0-1 (fractions, not percentages).
 * Fields may be undefined when data is unavailable.
 */
export interface TrustInput {
  /** Fraction of transactions completed successfully (0-1). Seller + Buyer. */
  transaction_completion_rate?: number;
  /** Fraction of disputes won (0-1). Seller + Buyer. */
  dispute_win_rate?: number;
  /** Fraction of transactions that resulted in a dispute (0-1). Seller + Buyer. Lower is better. */
  dispute_rate?: number;
  /** Fraction of orders shipped within SLA (0-1). Seller only. */
  sla_compliance_rate?: number;
  /** Fraction of transactions cancelled (0-1). Seller + Buyer. Lower is better. */
  cancellation_rate?: number;
  /** Fraction of deliveries auto-confirmed by buyer (0-1). Buyer only. */
  auto_confirm_rate?: number;
  /** Average peer rating (0-5 star scale). Seller + Buyer. */
  peer_rating?: number;
  /** Total number of completed transactions. Both roles. */
  transaction_frequency?: number;
  /** Account age in days. Both roles. */
  account_age_days?: number;
}

// ---------------------------------------------------------------------------
// Trust Score Status
// ---------------------------------------------------------------------------

/** Cold-start progression stages. */
export type TrustStatus = "NEW" | "SCORING" | "MATURE";

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

/** The role context for score computation. */
export type TrustRole = "seller" | "buyer" | "combined";

// ---------------------------------------------------------------------------
// Input Key
// ---------------------------------------------------------------------------

export type TrustInputKey = keyof TrustInput;

// ---------------------------------------------------------------------------
// Weight Configuration
// ---------------------------------------------------------------------------

/** Direction of a metric: higher-is-better, lower-is-better, or needs normalization. */
export type InputDirection = "higher" | "lower" | "normalize";

/** Normalization strategy for a metric. */
export type NormalizationType = "rate" | "inverse_rate" | "frequency" | "age" | "rating";

/** Configuration for a single trust input. */
export interface InputConfig {
  weight: number;
  direction: InputDirection;
  normalization: NormalizationType;
  applies_to_seller: boolean;
  applies_to_buyer: boolean;
}

/** Full weight configuration for trust score computation. */
export type WeightConfig = Record<TrustInputKey, InputConfig>;

// ---------------------------------------------------------------------------
// SLA Penalty
// ---------------------------------------------------------------------------

export interface SlaPenalty {
  /** Number of SLA violations. */
  sla_violation_count: number;
}

// ---------------------------------------------------------------------------
// Trust Result
// ---------------------------------------------------------------------------

export interface TrustResult {
  /** Computed trust score, clamped to [0, 100]. */
  score: number;
  /** Cold-start status. */
  status: TrustStatus;
  /** Number of completed transactions used for status determination. */
  completed_transactions: number;
  /** The role used for computation. */
  role: TrustRole;
  /** Weights version identifier. */
  weights_version: string;
  /** Raw score before SLA penalty (if penalty was applied). */
  raw_score: number;
  /** SLA penalty factor applied (1.0 = no penalty). */
  sla_penalty_factor: number;
}

// ---------------------------------------------------------------------------
// Trust Snapshot (for quarterly backtest)
// ---------------------------------------------------------------------------

export interface TrustSnapshot {
  user_id: string;
  snapshot_date: string;
  raw_inputs: TrustInput;
  computed_score: number;
  weights_version: string;
  /** Whether this user had a dispute in the next quarter. Filled retroactively. */
  next_quarter_dispute: boolean;
}

// ---------------------------------------------------------------------------
// Computation Options
// ---------------------------------------------------------------------------

export interface ComputeOptions {
  /** Role context for filtering applicable inputs. Default: "combined". */
  role?: TrustRole;
  /** Number of completed transactions (for cold-start status). */
  completed_transactions: number;
  /** Optional SLA penalty. */
  sla_penalty?: SlaPenalty;
  /** Optional weight config override. Default: DEFAULT_WEIGHT_CONFIG. */
  weights?: WeightConfig;
}
