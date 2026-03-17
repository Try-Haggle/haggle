/**
 * Formal NegotiationEngine interface (Section 2 of the spec).
 *
 * This is the contract that any negotiation engine must implement.
 * HNP = WHAT to negotiate, Engine = HOW to judge and move.
 */

import type {
  IssueValues,
  IssueDefinition,
  DecisionAction,
  MultiIssueUtilityResult,
  IssueWeight,
  RiskCostParams,
  RelationshipBonusParams,
  IssueFaratinParams,
} from '@haggle/engine-core';
import type { MultiIssueOpponentModel } from './round/multi-issue-opponent.js';
import type { HnpRole } from './protocol/types.js';

/**
 * Formal NegotiationEngine interface (Section 2 of the spec).
 *
 * This is the contract that any negotiation engine must implement.
 * HNP = WHAT to negotiate, Engine = HOW to judge and move.
 */
export interface NegotiationEngine {
  /** Evaluate an incoming offer and return utility + decision. */
  evaluate(
    offer: IssueValues,
    context: EngineContext,
  ): EngineEvaluation;

  /** Generate a counter-offer given current context. */
  counter(
    context: EngineContext,
  ): EngineCounterOffer;

  /** Update the engine's opponent model with a new observation. */
  observeOpponent(
    previousOffer: IssueValues,
    currentOffer: IssueValues,
    context: EngineContext,
  ): MultiIssueOpponentModel;
}

/** Context required by the engine for any operation. */
export interface EngineContext {
  /** Issue definitions from the schema. */
  definitions: IssueDefinition[];
  /** Per-issue weights. */
  weights: IssueWeight[];
  /** Risk parameters. */
  risk: RiskCostParams;
  /** Relationship parameters. */
  relationship: RelationshipBonusParams;
  /** Acceptance threshold parameters. */
  threshold: {
    u_batna: number;
    u_min: number;
    u_0: number;
    tau: number;
    beta: number;
  };
  /** Previous own offer (for move cost). */
  previous_own_offer?: IssueValues;
  /** Opponent's last offer (for acceptance probability). */
  opponent_last_offer?: IssueValues;
  /** Current opponent model. */
  opponent_model?: MultiIssueOpponentModel;
  /** Per-issue Faratin start/limit values. */
  issue_params: IssueFaratinParams[];
  /** Total deadline. */
  t_deadline: number;
  /** Rounds with no concession from opponent. */
  rounds_no_concession: number;
  /** Offer search alpha/eta (optional). */
  alpha?: number;
  eta?: number;
  /** Sender role for opponent model. */
  sender_role: HnpRole;
}

/** Result of evaluating an offer. */
export interface EngineEvaluation {
  utility: MultiIssueUtilityResult;
  decision: DecisionAction;
  acceptance_threshold: number;
  utility_gap: number;
  /** If NEAR_DEAL, how close we are to acceptance [0,1]. */
  near_deal_proximity?: number;
}

/** Result of generating a counter-offer. */
export interface EngineCounterOffer {
  values: IssueValues;
  /** Target utility level. */
  u_target: number;
  /** J(w) score if offer search was used. */
  search_score?: number;
}
