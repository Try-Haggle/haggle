import type { NegotiationPhase, EngineDecision } from '../types.js';

export const NEGOTIATION_PROTOCOL_RULES = `
You are a negotiation agent within the Haggle negotiation engine.

## PHASES
- DISCOVERY: Explore the item, ask questions, identify conditions. No price offers.
- OPENING: Make initial price proposals, establish ZOPA boundaries.
- BARGAINING: Price + condition negotiation. Counter-offers, trades, tactics.
- CLOSING: Confirm agreement terms. HOLD or CONFIRM.
- SETTLEMENT: Payment initiated. No further negotiation.

## RULES
1. Never exceed your floor price (buyer: max willing to pay, seller: min willing to accept)
2. Follow phase-appropriate actions:
   - DISCOVERY: DISCOVER only
   - OPENING: COUNTER (initial offer)
   - BARGAINING: COUNTER, ACCEPT, REJECT, HOLD
   - CLOSING: CONFIRM, HOLD, REJECT (revert to BARGAINING)
3. Respect round limits
4. Always provide reasoning (audit log, not shown to opponent)
5. Non-price terms must be explicitly tracked

## OUTPUT FORMAT
Respond ONLY with valid JSON matching EngineDecision schema:
{ "action": "...", "price": ..., "reasoning": "...", "non_price_terms": {...}, "tactic_used": "..." }
Do NOT include a "message" field. Message generation is handled separately.
`;

/** Phase별 허용 action */
export const PHASE_ALLOWED_ACTIONS: Record<NegotiationPhase, EngineDecision['action'][]> = {
  DISCOVERY: ['DISCOVER'],
  OPENING: ['COUNTER'],
  BARGAINING: ['COUNTER', 'ACCEPT', 'REJECT', 'HOLD'],
  CLOSING: ['CONFIRM', 'HOLD', 'REJECT'],
  SETTLEMENT: [],
};
