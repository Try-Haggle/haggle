import type { UtilityResult, DecisionAction } from '@haggle/engine-core';
import type { HnpMessage, HnpRole } from '../protocol/types.js';

/** Session lifecycle status. */
export type SessionStatus =
  | 'CREATED'
  | 'ACTIVE'
  | 'NEAR_DEAL'
  | 'STALLED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'SUPERSEDED'
  | 'WAITING';

/** A single negotiation round record. */
export interface NegotiationRound {
  round_no: number;
  message: HnpMessage;
  utility?: UtilityResult;
  decision?: DecisionAction;
  counter_price?: number;
}

/** Full negotiation session state. JSON-serializable for persistence by the app layer. */
export interface NegotiationSession {
  session_id: string;
  strategy_id: string;
  role: HnpRole;
  status: SessionStatus;
  counterparty_id: string;
  rounds: NegotiationRound[];
  current_round: number;
  rounds_no_concession: number;
  last_offer_price: number | null;
  last_utility: UtilityResult | null;
  created_at: number;
  updated_at: number;
}
