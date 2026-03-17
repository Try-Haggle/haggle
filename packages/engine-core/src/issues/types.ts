/**
 * Issue-based Negotiation Type System
 *
 * HNP treats every negotiation as an issue bundle, not just price.
 * This module defines the generic issue model that supports
 * electronics, vehicles, real estate, services, and any future domain.
 */

// ---------------------------------------------------------------------------
// Issue Definition (schema-level)
// ---------------------------------------------------------------------------

/** How an issue value is represented. */
export type IssueValueType = 'scalar' | 'deadline' | 'enum' | 'boolean';

/** Preference direction for negotiable issues. */
export type IssueDirection = 'lower_better' | 'higher_better';

/** Role of an issue in a negotiation. */
export type IssueCategory = 'negotiable' | 'informational' | 'conditional';

/** A single issue definition within an IssueSchema. */
export interface IssueDefinition {
  /** Unique name within the schema (e.g. "price", "ship_within_hours"). */
  name: string;
  type: IssueValueType;
  category: IssueCategory;
  /** Preference direction — required for negotiable issues. */
  direction?: IssueDirection;
  /** Allowed values — required for enum type. */
  values?: readonly string[];
  /** Lower bound (inclusive) — for scalar/deadline. */
  min?: number;
  /** Upper bound (inclusive) — for scalar/deadline. */
  max?: number;
}

/**
 * An issue schema defines the negotiable space for a domain.
 * Example: "electronics_shipping_v1" with price, ship_within_hours, warranty_days, etc.
 */
export interface IssueSchema {
  schema_id: string;
  negotiable_issues: IssueDefinition[];
  informational_issues: IssueDefinition[];
  conditional_terms_supported: boolean;
}

// ---------------------------------------------------------------------------
// Issue Values (offer-level)
// ---------------------------------------------------------------------------

/** Runtime value of a single issue. */
export type IssueValue = number | string | boolean;

/** Map of issue name → value, as proposed in an offer. */
export type IssueValues = Record<string, IssueValue>;

// ---------------------------------------------------------------------------
// Issue Utility (computation-level)
// ---------------------------------------------------------------------------

/** Weight assigned to an issue for utility computation. All weights sum to 1. */
export interface IssueWeight {
  issue_name: string;
  weight: number;
}

/** Result of computing utility for a single issue. */
export interface IssueUtilityResult {
  issue_name: string;
  raw_value: IssueValue;
  /** Normalized utility in [0, 1]. */
  utility: number;
}

/**
 * Multi-issue utility breakdown.
 * U_contract = sum(w_i * v_i) for negotiable + sum(w_j * v_j) for informational
 */
export interface MultiIssueUtilityResult {
  /** Per-issue utility breakdown. */
  issue_utilities: IssueUtilityResult[];
  /** Weighted contract utility: sum(w_i * v_i(x_i)). */
  u_contract: number;
  /** Risk cost: lambda_f*p_fraud + lambda_q*p_quality + lambda_d*p_delay + lambda_s*p_dispute. */
  c_risk: number;
  /** Relationship bonus: rho_1*q_rep + rho_2*q_repeat + rho_3*q_responsiveness. */
  b_rel: number;
  /** Total utility: clip(u_contract - c_risk + b_rel, 0, 1). */
  u_total: number;
}

// ---------------------------------------------------------------------------
// Risk & Relationship (vNext model from Section 11.2)
// ---------------------------------------------------------------------------

/** Risk cost parameters — C_risk(omega, c). */
export interface RiskCostParams {
  /** Fraud probability [0, 1]. */
  p_fraud: number;
  /** Quality mismatch probability [0, 1]. */
  p_quality: number;
  /** Delivery delay probability [0, 1]. */
  p_delay: number;
  /** Dispute probability [0, 1]. */
  p_dispute: number;
  /** Weight for each risk dimension. */
  lambda_f: number;
  lambda_q: number;
  lambda_d: number;
  lambda_s: number;
}

/** Relationship bonus parameters — B_rel(c). */
export interface RelationshipBonusParams {
  /** Reputation quality [0, 1]. */
  q_reputation: number;
  /** Repeat transaction quality [0, 1]. */
  q_repeat: number;
  /** Responsiveness quality [0, 1]. */
  q_responsiveness: number;
  /** Weights for each relationship dimension. */
  rho_1: number;
  rho_2: number;
  rho_3: number;
}

// ---------------------------------------------------------------------------
// Acceptance Threshold (Section 11.3)
// ---------------------------------------------------------------------------

/**
 * Dynamic acceptance threshold:
 * R(t) = max{ U_BATNA(t), U_min + (U_0 - U_min)(1 - tau(t)^beta) }
 */
export interface AcceptanceThresholdParams {
  /** BATNA utility at time t. */
  u_batna: number;
  /** Minimum acceptable utility. */
  u_min: number;
  /** Initial aspiration utility. */
  u_0: number;
  /** Normalized time progress tau(t) in [0, 1]. */
  tau: number;
  /** Concession rate parameter. */
  beta: number;
}

// ---------------------------------------------------------------------------
// Offer Search (Section 11.4)
// ---------------------------------------------------------------------------

/**
 * Offer search objective:
 * J(omega) = alpha * U_total(omega, c_t) + (1-alpha) * P_accept_hat(omega | m_t) - eta * C_move(omega, omega_prev)
 */
export interface OfferSearchParams {
  /** Self-utility weight. */
  alpha: number;
  /** Move cost penalty. */
  eta: number;
}

// ---------------------------------------------------------------------------
// Parallel Negotiation (Section 11.5)
// ---------------------------------------------------------------------------

/**
 * Expected utility for a parallel session:
 * EU_s = P_close_hat_s * U_total(omega*_s, c_s) + (1 - P_close_hat_s) * U_BATNA_neg_s - kappa * T_s
 */
export interface ParallelSessionEval {
  session_id: string;
  /** Estimated close probability [0, 1]. */
  p_close: number;
  /** Best achievable utility in this session. */
  u_best: number;
  /** BATNA utility from other sessions. */
  u_batna_other: number;
  /** Time cost factor. */
  kappa: number;
  /** Time spent in this session (normalized). */
  t_spent: number;
  /** Expected utility = p_close * u_best + (1-p_close) * u_batna_other - kappa * t_spent. */
  eu: number;
}
