/**
 * Multi-Issue Decision Maker
 *
 * Uses the vNext acceptance threshold R(t) with BATNA integration.
 * Replaces the rule-based v1 decision maker for multi-issue contexts.
 *
 * Accept iff: U_total(ω_opp, c_t) >= R(t)
 */

import type { DecisionAction } from '../decision/types.js';
import type { AcceptanceThresholdParams, MultiIssueUtilityResult } from './types.js';
import { computeAcceptanceThreshold } from './acceptance.js';

/** Input for multi-issue decision making. */
export interface MultiIssueDecisionInput {
  /** Utility result from evaluating the opponent's offer. */
  utility: MultiIssueUtilityResult;
  /** Acceptance threshold parameters (includes BATNA). */
  threshold_params: AcceptanceThresholdParams;
  /** Normalized time progress [0, 1]. */
  tau: number;
  /** Rounds with no concession from opponent. */
  rounds_no_concession: number;
  /** Stall threshold (default 4). */
  stall_threshold?: number;
  /** Deadline critical zone (default 0.05 of remaining time). */
  deadline_critical?: number;
  /** Band below R(t) where NEAR_DEAL is signaled (default 0.05). */
  near_deal_band?: number;
}

/** Multi-issue decision result with reasoning. */
export interface MultiIssueDecision {
  action: DecisionAction;
  /** The computed acceptance threshold R(t). */
  acceptance_threshold: number;
  /** Gap between offer utility and threshold. */
  utility_gap: number;
  /** If NEAR_DEAL, how close we are to acceptance [0,1]. */
  near_deal_proximity?: number;
}

/**
 * Make a decision on a multi-issue offer.
 *
 * Priority:
 * 1. u_total >= R(t) → ACCEPT
 * 2. rounds_no_concession >= stall_threshold → ESCALATE
 * 3. tau >= (1 - deadline_critical) AND u_total < R(t) → ESCALATE
 * 4. u_total > 0 → COUNTER
 * 5. else → REJECT
 */
export function makeMultiIssueDecision(input: MultiIssueDecisionInput): MultiIssueDecision {
  const {
    utility,
    threshold_params,
    tau,
    rounds_no_concession,
    stall_threshold = 4,
    deadline_critical = 0.05,
    near_deal_band = 0.05,
  } = input;

  const R = computeAcceptanceThreshold(threshold_params);
  const u = utility.u_total;
  const gap = u - R;

  // 1. Accept if utility meets or exceeds threshold
  if (u >= R) {
    return { action: 'ACCEPT', acceptance_threshold: R, utility_gap: gap };
  }

  // 1.5. NEAR_DEAL if within the near-deal band below threshold
  if (u >= R - near_deal_band && u < R) {
    return {
      action: 'NEAR_DEAL',
      acceptance_threshold: R,
      utility_gap: gap,
      near_deal_proximity: (u - (R - near_deal_band)) / near_deal_band,
    };
  }

  // 2. Escalate on stall
  if (rounds_no_concession >= stall_threshold) {
    return { action: 'ESCALATE', acceptance_threshold: R, utility_gap: gap };
  }

  // 3. Escalate near deadline with no deal
  if (tau >= 1 - deadline_critical && u < R) {
    return { action: 'ESCALATE', acceptance_threshold: R, utility_gap: gap };
  }

  // 4. Counter if offer has any value
  if (u > 0) {
    return { action: 'COUNTER', acceptance_threshold: R, utility_gap: gap };
  }

  // 5. Reject
  return { action: 'REJECT', acceptance_threshold: R, utility_gap: gap };
}
