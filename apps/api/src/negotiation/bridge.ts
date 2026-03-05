import {
  createSession,
  executeRound,
  validateStrategy,
  validateRoundData,
  checkTimeout,
  type HnpMessage,
  type HnpMessageType,
  type RoundData,
} from '@haggle/engine-session';
import type { SessionStore } from './session-store.js';
import { generateStrategy } from './strategy-gen.js';
import {
  BridgeErrorCode,
  type BridgeResult,
  type StartSessionInput,
  type StartSessionResult,
  type SubmitOfferInput,
  type SubmitOfferResult,
  type SessionStateResult,
} from './types.js';

const TERMINAL_STATUSES = new Set(['ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED']);

function fail<T>(code: BridgeErrorCode, message: string): BridgeResult<T> {
  return { ok: false, error: { code, message } };
}

export class NegotiationBridge {
  constructor(private readonly store: SessionStore) {}

  async startSession(input: StartSessionInput): Promise<BridgeResult<StartSessionResult>> {
    // 1. Generate strategy
    const strategy = generateStrategy(input.listing, input.role, input.persona);
    strategy.user_id = input.user_id;

    // 2. Validate strategy
    const validationError = validateStrategy(strategy);
    if (validationError !== null) {
      return fail(BridgeErrorCode.INVALID_STRATEGY, `Strategy validation failed: ${validationError}`);
    }

    // 3. Create session
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session = createSession({
      session_id: sessionId,
      strategy_id: strategy.id,
      role: input.role,
      counterparty_id: input.counterparty_id,
    });

    // 4. Store
    await this.store.save({ session, strategy });

    return { ok: true, data: { session, strategy_id: strategy.id } };
  }

  async submitOffer(input: SubmitOfferInput): Promise<BridgeResult<SubmitOfferResult>> {
    const now = Date.now();

    // 1. Lookup
    const stored = await this.store.get(input.session_id);
    if (!stored) {
      return fail(BridgeErrorCode.SESSION_NOT_FOUND, `Session ${input.session_id} not found`);
    }

    const { session, strategy } = stored;

    // 2. Terminal check
    if (TERMINAL_STATUSES.has(session.status)) {
      return fail(BridgeErrorCode.SESSION_TERMINAL, `Session is in terminal state: ${session.status}`);
    }

    // 3. Timeout check
    if (checkTimeout(session, strategy, now)) {
      const expiredSession = { ...session, status: 'EXPIRED' as const, updated_at: now };
      await this.store.save({ session: expiredSession, strategy });
      return fail(BridgeErrorCode.SESSION_EXPIRED, 'Session has expired');
    }

    // 4. Price validation
    if (input.price <= 0) {
      return fail(BridgeErrorCode.INVALID_PRICE, 'Price must be positive');
    }

    // 5. Compute t_elapsed
    const t_elapsed = (now - session.created_at) / 1000;

    // 6. Assemble RoundData
    const roundData: RoundData = {
      p_effective: input.price,
      r_score: strategy.w_rep,
      i_completeness: strategy.w_info,
      t_elapsed,
      n_success: 0,
      n_dispute_losses: 0,
    };

    // 7. Validate round data
    const rdError = validateRoundData(roundData);
    if (rdError !== null) {
      return fail(BridgeErrorCode.INVALID_OFFER, `Round data validation failed: ${rdError}`);
    }

    // 8. Build incoming HnpMessage
    const isFirstRound = session.current_round === 0;
    const messageType: HnpMessageType = isFirstRound ? 'OFFER' : 'COUNTER';
    const incomingMessage: HnpMessage = {
      session_id: input.session_id,
      round: session.current_round + 1,
      type: messageType,
      price: input.price,
      sender_role: input.sender_role,
      timestamp: now,
    };

    // 9. Execute round
    const result = executeRound(session, strategy, incomingMessage, roundData);

    // 10. Check engine error
    if (result.error) {
      return fail(BridgeErrorCode.ENGINE_ERROR, `Engine error: ${result.error}`);
    }

    // 11. Save updated session
    await this.store.save({ session: result.session, strategy });

    // 12. Return result
    return {
      ok: true,
      data: {
        message: result.message,
        decision: result.decision,
        utility: result.utility,
        session: result.session,
        escalation: result.escalation,
      },
    };
  }

  async getSessionState(sessionId: string): Promise<BridgeResult<SessionStateResult>> {
    const now = Date.now();

    // 1. Lookup
    const stored = await this.store.get(sessionId);
    if (!stored) {
      return fail(BridgeErrorCode.SESSION_NOT_FOUND, `Session ${sessionId} not found`);
    }

    let { session } = stored;
    const { strategy } = stored;

    // 2. Auto-expire if timed out and not terminal
    if (!TERMINAL_STATUSES.has(session.status) && checkTimeout(session, strategy, now)) {
      session = { ...session, status: 'EXPIRED', updated_at: now };
      await this.store.save({ session, strategy });
    }

    return {
      ok: true,
      data: {
        session,
        status: session.status,
        round_count: session.current_round,
        is_terminal: TERMINAL_STATUSES.has(session.status),
      },
    };
  }
}
