// Hash chain types for tamper-proof negotiation records (Doc 31 §4).

/**
 * Canonical payload for a single round fact hash.
 * All fields that contribute to the hash must be listed here.
 */
export interface RoundFactPayload {
  session_id: string;
  round_no: number;
  buyer_offer: string | null;
  seller_offer: string | null;
  gap: string | null;
  buyer_tactic: string | null;
  seller_tactic: string | null;
  conditions_changed: unknown[] | null;
  coaching_recommended_price: string | null;
  coaching_recommended_tactic: string | null;
  coaching_followed: boolean | null;
  human_intervened: boolean;
  phase: string | null;
}

/**
 * Result of computing a fact hash for a single round.
 */
export interface FactHashResult {
  fact_hash: string;
  prev_fact_hash: string | null;
}

/**
 * Result of verifying a hash chain.
 */
export interface ChainVerificationResult {
  valid: boolean;
  /** The round number where the chain first broke, or null if valid. */
  broken_at_round: number | null;
  /** Total rounds verified. */
  rounds_verified: number;
}
