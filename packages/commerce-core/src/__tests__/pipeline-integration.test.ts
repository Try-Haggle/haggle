/**
 * Step 40 — Pipeline router integration tests.
 * End-to-end lifecycle flows through the pipeline router.
 */
import { describe, it, expect } from 'vitest';
import { routePipelineEvent } from '../pipeline-router.js';
import { defaultPipelineContext } from '../pipeline-events.js';
import type { PipelineEvent, PipelineAction, PipelineContext } from '../pipeline-events.js';

function ctx(overrides?: Partial<PipelineContext>): PipelineContext {
  return { ...defaultPipelineContext(), ...overrides };
}

describe('pipeline lifecycle: happy path', () => {
  it('intent → session → settlement → payment', () => {
    // 1. Intent matched
    const a1 = routePipelineEvent(
      { type: 'intent.matched', intentId: 'i-1', listingId: 'l-1', utotal: 0.8 },
      ctx(),
    );
    expect(a1.action).toBe('create_session');

    // 2. Session accepted
    const a2 = routePipelineEvent(
      { type: 'session.accepted', sessionId: 's-1', agreedPriceMinor: 5000, buyerId: 'b-1', sellerId: 'se-1' },
      ctx(),
    );
    expect(a2.action).toBe('create_settlement');

    // 3. Approval approved
    const a3 = routePipelineEvent(
      { type: 'approval.approved', sessionId: 's-1', settlementId: 'stl-1' },
      ctx(),
    );
    expect(a3.action).toBe('create_payment_intent');

    // 4. Payment settled
    const a4 = routePipelineEvent(
      { type: 'payment.settled', sessionId: 's-1', paymentId: 'p-1', amountMinor: 5000 },
      ctx(),
    );
    expect(a4.action).toBe('no_action');
  });
});

describe('pipeline lifecycle: rejection → rematch', () => {
  it('rejected session with intent triggers rematch', () => {
    const action = routePipelineEvent(
      { type: 'session.terminal', sessionId: 's-1', terminalStatus: 'REJECTED', intentId: 'i-1', rematchCount: 0 },
      ctx(),
    );
    expect(action.action).toBe('rematch_intent');
    if (action.action === 'rematch_intent') {
      expect(action.intentId).toBe('i-1');
      expect(action.previousSessionId).toBe('s-1');
    }
  });

  it('progressive rematch exhaustion', () => {
    // Count 0, 1, 2 → rematch
    for (let i = 0; i < 3; i++) {
      const action = routePipelineEvent(
        { type: 'session.terminal', sessionId: `s-${i}`, terminalStatus: 'REJECTED', intentId: 'i-1', rematchCount: i },
        ctx(),
      );
      expect(action.action).toBe('rematch_intent');
    }

    // Count 3 → exhausted
    const action = routePipelineEvent(
      { type: 'session.terminal', sessionId: 's-3', terminalStatus: 'REJECTED', intentId: 'i-1', rematchCount: 3 },
      ctx(),
    );
    expect(action.action).toBe('no_action');
  });
});

describe('pipeline lifecycle: hold expiration', () => {
  it('SOFT_HOLD expired → reprice', () => {
    const action = routePipelineEvent(
      { type: 'hold.expired', sessionId: 's-1', holdKind: 'SOFT_HOLD', heldPriceMinor: 5000 },
      ctx(),
    );
    expect(action.action).toBe('reprice_session');
    if (action.action === 'reprice_session') {
      expect(action.previousPriceMinor).toBe(5000);
    }
  });

  it('SELLER_RESERVED expired → no action needed', () => {
    const action = routePipelineEvent(
      { type: 'hold.expired', sessionId: 's-1', holdKind: 'SELLER_RESERVED', heldPriceMinor: 9900 },
      ctx(),
    );
    expect(action.action).toBe('no_action');
  });
});

describe('pipeline router: edge cases', () => {
  it('session.terminal without rematchCount defaults to 0', () => {
    const action = routePipelineEvent(
      { type: 'session.terminal', sessionId: 's-1', terminalStatus: 'EXPIRED', intentId: 'i-1' },
      ctx(),
    );
    // rematchCount defaults to 0, so rematch should be allowed
    expect(action.action).toBe('rematch_intent');
  });

  it('custom maxRematchCount is respected', () => {
    const action = routePipelineEvent(
      { type: 'session.terminal', sessionId: 's-1', terminalStatus: 'REJECTED', intentId: 'i-1', rematchCount: 1 },
      ctx({ maxRematchCount: 1 }),
    );
    expect(action.action).toBe('no_action');
  });

  it('all event types produce valid actions', () => {
    const events: PipelineEvent[] = [
      { type: 'intent.matched', intentId: 'i', listingId: 'l', utotal: 0.5 },
      { type: 'session.accepted', sessionId: 's', agreedPriceMinor: 100, buyerId: 'b', sellerId: 'se' },
      { type: 'approval.approved', sessionId: 's', settlementId: 'st' },
      { type: 'payment.settled', sessionId: 's', paymentId: 'p', amountMinor: 100 },
      { type: 'hold.expired', sessionId: 's', holdKind: 'SOFT_HOLD', heldPriceMinor: 100 },
      { type: 'session.terminal', sessionId: 's', terminalStatus: 'REJECTED' },
    ];
    for (const event of events) {
      const action = routePipelineEvent(event, ctx());
      expect(action).toBeDefined();
      expect(action.action).toBeDefined();
    }
  });
});
