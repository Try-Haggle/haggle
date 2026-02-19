import { describe, it, expect } from 'vitest';
import { transition } from '../src/session/state-machine.js';
import type { SessionEvent } from '../src/session/state-machine.js';
import type { SessionStatus } from '../src/session/types.js';

describe('state machine — valid transitions', () => {
  const validCases: [SessionStatus, SessionEvent, SessionStatus][] = [
    // CREATED
    ['CREATED', 'first_offer', 'ACTIVE'],
    ['CREATED', 'superseded', 'SUPERSEDED'],

    // ACTIVE
    ['ACTIVE', 'counter', 'ACTIVE'],
    ['ACTIVE', 'near_deal', 'NEAR_DEAL'],
    ['ACTIVE', 'stalled', 'STALLED'],
    ['ACTIVE', 'timeout', 'EXPIRED'],
    ['ACTIVE', 'user_accept', 'ACCEPTED'],
    ['ACTIVE', 'user_reject', 'REJECTED'],
    ['ACTIVE', 'superseded', 'SUPERSEDED'],
    ['ACTIVE', 'escalate', 'WAITING'],

    // NEAR_DEAL
    ['NEAR_DEAL', 'user_accept', 'ACCEPTED'],
    ['NEAR_DEAL', 'user_reject', 'REJECTED'],
    ['NEAR_DEAL', 'counter', 'ACTIVE'],
    ['NEAR_DEAL', 'timeout', 'EXPIRED'],
    ['NEAR_DEAL', 'superseded', 'SUPERSEDED'],
    ['NEAR_DEAL', 'escalate', 'WAITING'],

    // STALLED
    ['STALLED', 'strategy_update', 'ACTIVE'],
    ['STALLED', 'timeout', 'EXPIRED'],
    ['STALLED', 'user_reject', 'REJECTED'],
    ['STALLED', 'superseded', 'SUPERSEDED'],
    ['STALLED', 'escalate', 'WAITING'],

    // WAITING
    ['WAITING', 'escalation_resolved', 'ACTIVE'],
    ['WAITING', 'timeout', 'EXPIRED'],
    ['WAITING', 'superseded', 'SUPERSEDED'],
    ['WAITING', 'user_reject', 'REJECTED'],
  ];

  it.each(validCases)(
    '%s + %s → %s',
    (current, event, expected) => {
      expect(transition(current, event)).toBe(expected);
    },
  );
});

describe('state machine — terminal states reject all events', () => {
  const terminalStates: SessionStatus[] = ['ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED'];
  const allEvents: SessionEvent[] = [
    'first_offer', 'counter', 'near_deal', 'stalled', 'timeout',
    'strategy_update', 'user_accept', 'user_reject', 'superseded',
    'escalate', 'escalation_resolved',
  ];

  for (const status of terminalStates) {
    for (const event of allEvents) {
      it(`${status} + ${event} → null`, () => {
        expect(transition(status, event)).toBeNull();
      });
    }
  }
});

describe('state machine — invalid transitions return null', () => {
  const invalidCases: [SessionStatus, SessionEvent][] = [
    ['CREATED', 'counter'],
    ['CREATED', 'near_deal'],
    ['CREATED', 'user_accept'],
    ['CREATED', 'stalled'],
    ['CREATED', 'strategy_update'],
    ['ACTIVE', 'first_offer'],
    ['ACTIVE', 'strategy_update'],
    ['ACTIVE', 'escalation_resolved'],
    ['NEAR_DEAL', 'first_offer'],
    ['NEAR_DEAL', 'stalled'],
    ['NEAR_DEAL', 'strategy_update'],
    ['STALLED', 'first_offer'],
    ['STALLED', 'counter'],
    ['STALLED', 'near_deal'],
    ['STALLED', 'user_accept'],
    ['WAITING', 'first_offer'],
    ['WAITING', 'counter'],
    ['WAITING', 'near_deal'],
    ['WAITING', 'stalled'],
    ['WAITING', 'user_accept'],
    ['WAITING', 'strategy_update'],
  ];

  it.each(invalidCases)(
    '%s + %s → null',
    (current, event) => {
      expect(transition(current, event)).toBeNull();
    },
  );
});
