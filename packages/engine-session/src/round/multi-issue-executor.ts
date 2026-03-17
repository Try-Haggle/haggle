/**
 * Multi-Issue Round Executor (vNext Pipeline)
 *
 * Executes a single round of multi-issue negotiation:
 * 1. Compute multi-issue utility for the incoming offer
 * 2. Make decision using acceptance threshold R(t)
 * 3. If COUNTER: compute counter-offer via Faratin concession
 * 4. If COUNTER: optimize counter-offer via J(ω) offer search
 * 5. Update multi-issue opponent model
 * 6. Return MultiIssueRoundResult
 *
 * Pure function — no DB, no API, no LLM calls.
 * LLM escalation is signaled via escalation_reason in the result.
 */

import type { MultiIssueMasterStrategy, MultiIssueRoundData } from '../strategy/types.js';
import type {
  IssueValues,
  IssueDefinition,
  MultiIssueUtilityResult,
  MultiIssueDecision,
  MultiIssueCounterResult,
  DecisionAction,
} from '@haggle/engine-core';
import {
  computeMultiIssueUtility,
  makeMultiIssueDecision,
  computeMultiIssueCounterOffer,
  searchOffer,
} from '@haggle/engine-core';
import type { MultiIssueOpponentModel } from './multi-issue-opponent.js';
import { createMultiIssueOpponentModel, updateMultiIssueOpponentModel } from './multi-issue-opponent.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** Result of executing a single multi-issue round. */
export interface MultiIssueRoundResult {
  decision: DecisionAction;
  utility: MultiIssueUtilityResult;
  acceptance_threshold: number;
  counter_offer?: IssueValues;
  counter_offer_score?: number;
  opponent_model: MultiIssueOpponentModel;
  escalation_reason?: 'STALL' | 'DEADLINE';
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a single multi-issue negotiation round.
 *
 * @param strategy       Multi-issue strategy configuration.
 * @param roundData      Per-round situational data (tau, risk, relationship).
 * @param incomingOffer  Opponent's proposed issue values.
 * @param definitions    Issue definitions from the negotiation schema.
 * @param previousOffer  Opponent's previous offer (for opponent model update).
 * @param opponentModel  Current opponent model (created fresh if undefined).
 */
export function executeMultiIssueRound(
  strategy: MultiIssueMasterStrategy,
  roundData: MultiIssueRoundData,
  incomingOffer: IssueValues,
  definitions: IssueDefinition[],
  previousOffer?: IssueValues,
  opponentModel?: MultiIssueOpponentModel,
): MultiIssueRoundResult {
  // --- 1. Compute utility for the incoming offer ---
  const negotiableDefinitions = definitions.filter(
    (d) => d.category === 'negotiable',
  );

  const utility: MultiIssueUtilityResult = computeMultiIssueUtility({
    contract: {
      definitions: negotiableDefinitions,
      weights: strategy.issue_weights,
      negotiable_values: incomingOffer,
    },
    risk: roundData.risk,
    relationship: roundData.relationship,
  });

  // --- 2. Make decision ---
  const thresholdParams = {
    u_batna: strategy.u_batna,
    u_min: strategy.u_min,
    u_0: strategy.u_0,
    tau: roundData.tau,
    beta: strategy.beta,
  };

  const model = opponentModel ?? createMultiIssueOpponentModel();
  const roundsNoConcession = estimateRoundsNoConcession(model);

  const decisionResult: MultiIssueDecision = makeMultiIssueDecision({
    utility,
    threshold_params: thresholdParams,
    tau: roundData.tau,
    rounds_no_concession: roundsNoConcession,
    stall_threshold: strategy.stall_threshold,
    deadline_critical: strategy.deadline_critical,
    near_deal_band: strategy.near_deal_band,
  });

  let decision = decisionResult.action;
  let counterOffer: IssueValues | undefined;
  let counterOfferScore: number | undefined;

  // --- 3. Compute counter-offer if COUNTER or NEAR_DEAL ---
  if (decision === 'COUNTER' || decision === 'NEAR_DEAL') {
    const counterResult: MultiIssueCounterResult = computeMultiIssueCounterOffer({
      issue_params: strategy.issue_params,
      weights: strategy.issue_weights,
      t: roundData.tau * strategy.t_deadline,
      T: strategy.t_deadline,
      beta: strategy.beta,
    });

    // --- 4. Optimize via J(ω) offer search ---
    const searchResult = searchOffer({
      base_offer: counterResult.values,
      definitions,
      weights: strategy.issue_weights,
      risk: roundData.risk,
      relationship: roundData.relationship,
      opponent_last_offer: incomingOffer,
      previous_own_offer: undefined, // Could be enhanced with own previous offer tracking
      alpha: strategy.alpha,
      eta: strategy.eta,
    });

    counterOffer = searchResult.offer;
    counterOfferScore = searchResult.score;
  }

  // --- 5. Update opponent model ---
  let updatedModel = model;
  if (previousOffer) {
    updatedModel = updateMultiIssueOpponentModel(
      model,
      {
        previous: previousOffer,
        current: incomingOffer,
        sender_role: 'SELLER', // Opponent is the other side; defaults to SELLER for buyer agent
        response_time_ms: roundData.response_time_ms,
      },
      definitions,
    );
  }

  // --- 6. Determine escalation reason ---
  let escalationReason: 'STALL' | 'DEADLINE' | undefined;
  if (decision === 'ESCALATE') {
    const stallThreshold = strategy.stall_threshold ?? 4;
    if (roundsNoConcession >= stallThreshold) {
      escalationReason = 'STALL';
    } else {
      escalationReason = 'DEADLINE';
    }
  }

  return {
    decision,
    utility,
    acceptance_threshold: decisionResult.acceptance_threshold,
    counter_offer: counterOffer,
    counter_offer_score: counterOfferScore,
    opponent_model: updatedModel,
    escalation_reason: escalationReason,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate rounds without concession from the multi-issue opponent model.
 * Uses the overall concession style as a proxy:
 * - 'slow' with low total rounds: likely stalling
 * - Otherwise: approximate from concession rates
 */
function estimateRoundsNoConcession(model: MultiIssueOpponentModel): number {
  if (model.total_rounds === 0) return 0;

  // Check if all trackers show near-zero concession
  const trackers = Object.values(model.issue_trackers);
  if (trackers.length === 0) return 0;

  const allSilent = trackers.every(
    (t) => Math.abs(t.concession_rate) < 0.05 && t.move_count > 0,
  );

  if (allSilent) {
    // Count consecutive silent rounds (approximate: use total rounds as upper bound)
    return Math.min(model.total_rounds, 10);
  }

  if (model.concession_style === 'slow') {
    // Slow concession is not quite stalling
    return Math.min(Math.floor(model.total_rounds * 0.5), 3);
  }

  return 0;
}
