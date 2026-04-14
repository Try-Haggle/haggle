// Session summary types for data moat (Doc 30).
// Pure value types — no DB/API/LLM dependencies.

/** Negotiation outcome classification. */
export type SessionOutcome = 'DEAL' | 'REJECT' | 'TIMEOUT' | 'WALKAWAY';

/** Concession behavior pattern (Faratin classification). */
export type ConcessionPattern = 'BOULWARE' | 'LINEAR' | 'CONCEDER';

/** Per-round snapshot for summary computation. */
export interface RoundSnapshot {
  round_no: number;
  /** Price offered in this round (minor units). */
  price_minor: number;
  /** Role of the actor who made this offer. */
  role: 'BUYER' | 'SELLER';
  /** Tactic used, if identified. */
  tactic_used?: string;
  /** Opponent tactic detected, if any. */
  opponent_tactic_detected?: string;
  /** Coach-recommended price (minor units), if available. */
  coach_recommended_minor?: number;
  /** Referee violations in this round. */
  violations?: { rule: string; severity: 'HARD' | 'SOFT' }[];
}

/** Computed session summary — the "moat data" record. */
export interface SessionSummary {
  session_id: string;
  category: string;
  /** Anonymized value range, e.g. "$100-500". */
  item_value_range: string;

  // ── Result ──
  outcome: SessionOutcome;
  /** Final agreed price in minor units. Undefined if no deal. */
  final_price_minor?: number;
  /** Discount rate from initial ask to final price (0.0–1.0). */
  discount_rate?: number;
  total_rounds: number;
  total_duration_minutes: number;

  // ── Process (moat data) ──
  /** Per-round price trajectory (minor units). */
  price_trajectory: number[];
  /** Per-round concession rates. */
  concession_rates: number[];
  /** Unique tactics used across the session. */
  tactics_used: string[];
  /** Tactic → success (led to deal or concession). */
  tactics_success: Record<string, boolean>;
  /** Conditions exchanged during negotiation. */
  conditions_exchanged: string[];

  // ── Pattern ──
  buyer_pattern: ConcessionPattern;
  seller_pattern: ConcessionPattern;
  referee_hard_violations: number;
  referee_soft_violations: number;

  // ── Engine performance ──
  /** Average absolute deviation between coach recommendation and actual price. */
  coach_vs_actual_avg_deviation: number;

  // ── Time context ──
  day_of_week: number;
  hour_of_day: number;
}
