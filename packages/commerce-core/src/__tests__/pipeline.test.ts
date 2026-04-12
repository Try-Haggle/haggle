import { describe, it, expect } from 'vitest';
import { routePipelineEvent } from '../pipeline-router.js';
import { defaultPipelineContext } from '../pipeline-events.js';
import type { PipelineEvent, PipelineContext } from '../pipeline-events.js';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return { ...defaultPipelineContext(), ...overrides };
}

describe('routePipelineEvent', () => {
  // ─── intent.matched ─────────────────────────────────

  it('intent.matched → create_session', () => {
    const event: PipelineEvent = {
      type: 'intent.matched',
      intentId: 'int-1',
      listingId: 'lst-1',
      utotal: 0.75,
    };
    const action = routePipelineEvent(event, makeContext());
    expect(action).toEqual({
      action: 'create_session',
      intentId: 'int-1',
      listingId: 'lst-1',
    });
  });

  // ─── session.accepted ───────────────────────────────

  it('session.accepted → create_settlement', () => {
    const event: PipelineEvent = {
      type: 'session.accepted',
      sessionId: 'sess-1',
      agreedPriceMinor: 5000,
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
    };
    const action = routePipelineEvent(event, makeContext());
    expect(action).toEqual({
      action: 'create_settlement',
      sessionId: 'sess-1',
      agreedPriceMinor: 5000,
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
    });
  });

  // ─── approval.approved ─────────────────────────────

  it('approval.approved → create_payment_intent', () => {
    const event: PipelineEvent = {
      type: 'approval.approved',
      sessionId: 'sess-1',
      settlementId: 'stl-1',
    };
    const action = routePipelineEvent(event, makeContext());
    expect(action).toEqual({
      action: 'create_payment_intent',
      sessionId: 'sess-1',
      settlementId: 'stl-1',
    });
  });

  // ─── hold.expired ──────────────────────────────────

  it('hold.expired SOFT_HOLD → reprice_session', () => {
    const event: PipelineEvent = {
      type: 'hold.expired',
      sessionId: 'sess-1',
      holdKind: 'SOFT_HOLD',
      heldPriceMinor: 5000,
    };
    const action = routePipelineEvent(event, makeContext());
    expect(action).toEqual({
      action: 'reprice_session',
      sessionId: 'sess-1',
      previousPriceMinor: 5000,
    });
  });

  it('hold.expired SELLER_RESERVED → no_action', () => {
    const event: PipelineEvent = {
      type: 'hold.expired',
      sessionId: 'sess-1',
      holdKind: 'SELLER_RESERVED',
      heldPriceMinor: 9900,
    };
    const action = routePipelineEvent(event, makeContext());
    expect(action.action).toBe('no_action');
  });

  // ─── payment.settled ───────────────────────────────

  it('payment.settled → no_action (pipeline complete)', () => {
    const event: PipelineEvent = {
      type: 'payment.settled',
      sessionId: 'sess-1',
      paymentId: 'pay-1',
      amountMinor: 5000,
    };
    const action = routePipelineEvent(event, makeContext());
    expect(action.action).toBe('no_action');
  });

  // ─── session.terminal ──────────────────────────────

  it('session.terminal REJECTED with intent → rematch_intent', () => {
    const event: PipelineEvent = {
      type: 'session.terminal',
      sessionId: 'sess-1',
      terminalStatus: 'REJECTED',
      intentId: 'int-1',
      rematchCount: 0,
    };
    const action = routePipelineEvent(event, makeContext());
    expect(action).toEqual({
      action: 'rematch_intent',
      intentId: 'int-1',
      previousSessionId: 'sess-1',
    });
  });

  it('session.terminal EXPIRED with intent → rematch_intent', () => {
    const event: PipelineEvent = {
      type: 'session.terminal',
      sessionId: 'sess-1',
      terminalStatus: 'EXPIRED',
      intentId: 'int-1',
      rematchCount: 1,
    };
    const action = routePipelineEvent(event, makeContext());
    expect(action.action).toBe('rematch_intent');
  });

  it('session.terminal SUPERSEDED with intent → rematch_intent', () => {
    const event: PipelineEvent = {
      type: 'session.terminal',
      sessionId: 'sess-1',
      terminalStatus: 'SUPERSEDED',
      intentId: 'int-1',
      rematchCount: 2,
    };
    const action = routePipelineEvent(event, makeContext());
    expect(action.action).toBe('rematch_intent');
  });

  it('session.terminal without intentId → no_action', () => {
    const event: PipelineEvent = {
      type: 'session.terminal',
      sessionId: 'sess-1',
      terminalStatus: 'REJECTED',
    };
    const action = routePipelineEvent(event, makeContext());
    expect(action.action).toBe('no_action');
  });

  it('session.terminal max rematch reached → no_action', () => {
    const event: PipelineEvent = {
      type: 'session.terminal',
      sessionId: 'sess-1',
      terminalStatus: 'REJECTED',
      intentId: 'int-1',
      rematchCount: 3,
    };
    const action = routePipelineEvent(event, makeContext());
    expect(action.action).toBe('no_action');
    if (action.action === 'no_action') {
      expect(action.reason).toContain('max rematch');
    }
  });

  it('session.terminal with rematch disabled → no_action', () => {
    const event: PipelineEvent = {
      type: 'session.terminal',
      sessionId: 'sess-1',
      terminalStatus: 'REJECTED',
      intentId: 'int-1',
      rematchCount: 0,
    };
    const action = routePipelineEvent(event, makeContext({ rematchEnabled: false }));
    expect(action.action).toBe('no_action');
  });
});

describe('defaultPipelineContext', () => {
  it('has sensible defaults', () => {
    const ctx = defaultPipelineContext();
    expect(ctx.rematchEnabled).toBe(true);
    expect(ctx.maxRematchCount).toBe(3);
  });
});
