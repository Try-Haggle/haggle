import type { UtilityResult, DecisionAction } from '@haggle/engine-core';
import type { HnpMessage } from '../protocol/types.js';
import type { NegotiationSession, NegotiationRound } from '../session/types.js';
import type { MasterStrategy } from '../strategy/types.js';
import type { SessionError } from '../errors/types.js';

// --- Opponent move classification types ---

/** Classification of opponent's price movement. */
export type OpponentMoveType = 'CONCESSION' | 'SELFISH' | 'SILENT';

/** A classified opponent move with magnitude. */
export interface OpponentMove {
  type: OpponentMoveType;
  /** Normalized magnitude of the move (0–1 relative to negotiation range). */
  magnitude: number;
}

/** EMA-based model of opponent behavior. */
export interface OpponentModel {
  /** EMA of opponent concession rate (positive = conceding). */
  concession_rate: number;
  /** Number of moves observed. */
  move_count: number;
  /** Last classified move. */
  last_move: OpponentMove | null;
}

/** Price range for normalizing opponent moves. */
export interface NegotiationRange {
  p_target: number;
  p_limit: number;
}

/** Result of executing a single negotiation round. */
export interface RoundResult {
  message: HnpMessage;
  utility: UtilityResult;
  decision: DecisionAction;
  session: NegotiationSession;
  escalation?: EscalationRequest;
  error?: SessionError;
  ac_next_triggered?: boolean;
}

/** Request for LLM escalation. This package does NOT call the LLM — it returns this for the app layer. */
export interface EscalationRequest {
  type: 'UNKNOWN_PROPOSAL' | 'STRATEGY_REVIEW';
  session_id: string;
  context: string;
  current_strategy: MasterStrategy;
  recent_rounds: NegotiationRound[];
}
