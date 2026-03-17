import { describe, it, expect } from 'vitest';
import {
  transitionHnp,
  isTerminalState,
  isFrozenState,
  getValidEvents,
  messageToEvent,
} from '../src/protocol/hnp-lifecycle.js';
import type { HnpSessionState } from '../src/protocol/hnp-types.js';

// ---------------------------------------------------------------------------
// Happy path: full lifecycle
// ---------------------------------------------------------------------------

describe('HNP v2 Lifecycle - Happy Path', () => {
  it('listing-based negotiation → settlement → close', () => {
    let state: HnpSessionState = 'INIT';

    state = transitionHnp(state, 'session_create')!;
    expect(state).toBe('OPEN');

    state = transitionHnp(state, 'offer')!;
    expect(state).toBe('PENDING_RESPONSE');

    state = transitionHnp(state, 'counter_offer')!;
    expect(state).toBe('OPEN');

    state = transitionHnp(state, 'offer')!;
    expect(state).toBe('PENDING_RESPONSE');

    state = transitionHnp(state, 'accept')!;
    expect(state).toBe('AGREED');

    state = transitionHnp(state, 'settlement_propose')!;
    expect(state).toBe('SETTLEMENT_PENDING');

    state = transitionHnp(state, 'settlement_confirmed')!;
    expect(state).toBe('SETTLED');

    state = transitionHnp(state, 'close')!;
    expect(state).toBe('CLOSED');

    // CLOSED is terminal
    expect(transitionHnp(state, 'close')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Negotiation flows
// ---------------------------------------------------------------------------

describe('HNP v2 Lifecycle - Negotiation', () => {
  it('multiple counter-offer rounds', () => {
    let state: HnpSessionState = 'INIT';
    state = transitionHnp(state, 'session_create')!;

    // 3 rounds of offer ↔ counter
    for (let i = 0; i < 3; i++) {
      state = transitionHnp(state, 'offer')!;
      expect(state).toBe('PENDING_RESPONSE');
      state = transitionHnp(state, 'counter_offer')!;
      expect(state).toBe('OPEN');
    }

    // Final acceptance
    state = transitionHnp(state, 'offer')!;
    state = transitionHnp(state, 'accept')!;
    expect(state).toBe('AGREED');
  });

  it('direct rejection', () => {
    let state: HnpSessionState = 'INIT';
    state = transitionHnp(state, 'session_create')!;
    state = transitionHnp(state, 'offer')!;
    state = transitionHnp(state, 'reject')!;
    expect(state).toBe('REJECTED');
  });

  it('session decline at INIT', () => {
    const state = transitionHnp('INIT', 'session_decline');
    expect(state).toBe('REJECTED');
  });

  it('withdraw during negotiation', () => {
    let state: HnpSessionState = 'INIT';
    state = transitionHnp(state, 'session_create')!;
    state = transitionHnp(state, 'offer')!;
    state = transitionHnp(state, 'withdraw')!;
    expect(state).toBe('CANCELLED');
  });
});

// ---------------------------------------------------------------------------
// Timeout scenarios
// ---------------------------------------------------------------------------

describe('HNP v2 Lifecycle - Timeouts', () => {
  const nonTerminalStates: HnpSessionState[] = [
    'INIT', 'OPEN', 'PENDING_RESPONSE', 'AGREED', 'SETTLEMENT_PENDING',
  ];

  for (const state of nonTerminalStates) {
    it(`${state} → EXPIRED on timeout`, () => {
      expect(transitionHnp(state, 'timeout')).toBe('EXPIRED');
    });
  }

  it('EXPIRED can only close', () => {
    expect(transitionHnp('EXPIRED', 'close')).toBe('CLOSED');
    expect(transitionHnp('EXPIRED', 'offer')).toBeNull();
    expect(transitionHnp('EXPIRED', 'accept')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cancellation scenarios
// ---------------------------------------------------------------------------

describe('HNP v2 Lifecycle - Cancellations', () => {
  const cancellableStates: HnpSessionState[] = [
    'OPEN', 'PENDING_RESPONSE', 'AGREED', 'SETTLEMENT_PENDING',
  ];

  for (const state of cancellableStates) {
    it(`${state} → CANCELLED on session_cancel`, () => {
      expect(transitionHnp(state, 'session_cancel')).toBe('CANCELLED');
    });
  }
});

// ---------------------------------------------------------------------------
// Settlement lifecycle
// ---------------------------------------------------------------------------

describe('HNP v2 Lifecycle - Settlement', () => {
  it('AGREED → SETTLEMENT_PENDING → SETTLED', () => {
    let state = transitionHnp('AGREED', 'settlement_propose')!;
    expect(state).toBe('SETTLEMENT_PENDING');
    state = transitionHnp(state, 'settlement_confirmed')!;
    expect(state).toBe('SETTLED');
  });

  it('settlement failure → DISPUTED', () => {
    const state = transitionHnp('SETTLEMENT_PENDING', 'settlement_failed');
    expect(state).toBe('DISPUTED');
  });

  it('dispute can be resolved back to SETTLED', () => {
    const state = transitionHnp('DISPUTED', 'dispute_resolved');
    expect(state).toBe('SETTLED');
  });

  it('post-settlement dispute', () => {
    const state = transitionHnp('SETTLED', 'dispute_open');
    expect(state).toBe('DISPUTED');
  });
});

// ---------------------------------------------------------------------------
// Terminal / Frozen states
// ---------------------------------------------------------------------------

describe('isTerminalState', () => {
  it('CLOSED is terminal', () => {
    expect(isTerminalState('CLOSED')).toBe(true);
  });

  it('SETTLED is not terminal (can dispute or close)', () => {
    expect(isTerminalState('SETTLED')).toBe(false);
  });

  it('INIT is not terminal', () => {
    expect(isTerminalState('INIT')).toBe(false);
  });
});

describe('isFrozenState', () => {
  it('AGREED is frozen (no negotiation)', () => {
    expect(isFrozenState('AGREED')).toBe(true);
  });

  it('OPEN is not frozen', () => {
    expect(isFrozenState('OPEN')).toBe(false);
  });

  it('SETTLEMENT_PENDING is frozen', () => {
    expect(isFrozenState('SETTLEMENT_PENDING')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

describe('getValidEvents', () => {
  it('INIT has session_create, session_decline, timeout', () => {
    const events = getValidEvents('INIT');
    expect(events).toContain('session_create');
    expect(events).toContain('session_decline');
    expect(events).toContain('timeout');
  });

  it('CLOSED has no valid events', () => {
    expect(getValidEvents('CLOSED')).toHaveLength(0);
  });

  it('OPEN has offer, cancel, timeout, withdraw', () => {
    const events = getValidEvents('OPEN');
    expect(events).toContain('offer');
    expect(events).toContain('session_cancel');
  });
});

describe('messageToEvent', () => {
  it('maps OFFER → offer', () => {
    expect(messageToEvent('OFFER')).toBe('offer');
  });

  it('maps COUNTER_OFFER → counter_offer', () => {
    expect(messageToEvent('COUNTER_OFFER')).toBe('counter_offer');
  });

  it('maps ACCEPT → accept', () => {
    expect(messageToEvent('ACCEPT')).toBe('accept');
  });

  it('maps SETTLEMENT_CONFIRMED → settlement_confirmed', () => {
    expect(messageToEvent('SETTLEMENT_CONFIRMED')).toBe('settlement_confirmed');
  });

  it('returns null for discovery messages', () => {
    expect(messageToEvent('DISCOVERY_QUERY')).toBeNull();
    expect(messageToEvent('INTENT_CREATE')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Invalid transitions
// ---------------------------------------------------------------------------

describe('HNP v2 Lifecycle - Invalid transitions', () => {
  it('cannot negotiate from AGREED', () => {
    expect(transitionHnp('AGREED', 'offer')).toBeNull();
    expect(transitionHnp('AGREED', 'counter_offer')).toBeNull();
    expect(transitionHnp('AGREED', 'reject')).toBeNull();
  });

  it('cannot settle from OPEN', () => {
    expect(transitionHnp('OPEN', 'settlement_propose')).toBeNull();
    expect(transitionHnp('OPEN', 'settlement_confirmed')).toBeNull();
  });

  it('cannot accept from OPEN (must have pending offer)', () => {
    expect(transitionHnp('OPEN', 'accept')).toBeNull();
  });

  it('cannot create session from non-INIT', () => {
    expect(transitionHnp('OPEN', 'session_create')).toBeNull();
    expect(transitionHnp('AGREED', 'session_create')).toBeNull();
  });
});
