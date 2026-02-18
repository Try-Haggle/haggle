import type { UtilityResult, DecisionAction } from '@haggle/engine-core';
import type { HnpMessage } from '../protocol/types.js';
import type { NegotiationSession, NegotiationRound } from '../session/types.js';
import type { MasterStrategy } from '../strategy/types.js';

/** Result of executing a single negotiation round. */
export interface RoundResult {
  message: HnpMessage;
  utility: UtilityResult;
  decision: DecisionAction;
  session: NegotiationSession;
  escalation?: EscalationRequest;
}

/** Request for LLM escalation. This package does NOT call the LLM — it returns this for the app layer. */
export interface EscalationRequest {
  type: 'UNKNOWN_PROPOSAL' | 'STRATEGY_REVIEW';
  session_id: string;
  context: string;
  current_strategy: MasterStrategy;
  recent_rounds: NegotiationRound[];
}
