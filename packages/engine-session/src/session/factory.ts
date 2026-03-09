import type { HnpRole } from '../protocol/types.js';
import type { NegotiationSession } from './types.js';
import { createOpponentModel } from '../round/opponent-model.js';

export interface CreateSessionOptions {
  session_id: string;
  strategy_id: string;
  role: HnpRole;
  counterparty_id: string;
}

export function createSession(options: CreateSessionOptions): NegotiationSession {
  const now = Date.now();
  return {
    session_id: options.session_id,
    strategy_id: options.strategy_id,
    role: options.role,
    status: 'CREATED',
    counterparty_id: options.counterparty_id,
    rounds: [],
    current_round: 0,
    rounds_no_concession: 0,
    last_offer_price: null,
    last_utility: null,
    created_at: now,
    updated_at: now,
    opponent_model: createOpponentModel(),
  };
}
