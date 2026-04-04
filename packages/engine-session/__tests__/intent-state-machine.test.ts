import { describe, it, expect } from 'vitest';
import { transitionIntent } from '../src/intent/state-machine.js';
import type { IntentEvent } from '../src/intent/state-machine.js';
import type { IntentStatus } from '../src/intent/types.js';

describe('intent state machine — valid transitions', () => {
  const validCases: [IntentStatus, IntentEvent, IntentStatus][] = [
    // ACTIVE transitions
    ['ACTIVE', 'MATCH', 'MATCHED'],
    ['ACTIVE', 'EXPIRE', 'EXPIRED'],
    ['ACTIVE', 'CANCEL', 'CANCELLED'],

    // MATCHED transitions
    ['MATCHED', 'FULFILL', 'FULFILLED'],
    ['MATCHED', 'REMATCH', 'ACTIVE'],
    ['MATCHED', 'CANCEL', 'CANCELLED'],
  ];

  it.each(validCases)(
    '%s + %s → %s',
    (current, event, expected) => {
      expect(transitionIntent(current, event)).toBe(expected);
    },
  );
});

describe('intent state machine — terminal states reject all events', () => {
  const terminalStates: IntentStatus[] = ['FULFILLED', 'EXPIRED', 'CANCELLED'];
  const allEvents: IntentEvent[] = ['MATCH', 'FULFILL', 'EXPIRE', 'CANCEL', 'REMATCH'];

  for (const status of terminalStates) {
    for (const event of allEvents) {
      it(`${status} + ${event} → null`, () => {
        expect(transitionIntent(status, event)).toBeNull();
      });
    }
  }
});

describe('intent state machine — invalid transitions return null', () => {
  const invalidCases: [IntentStatus, IntentEvent][] = [
    // ACTIVE cannot FULFILL or REMATCH
    ['ACTIVE', 'FULFILL'],
    ['ACTIVE', 'REMATCH'],

    // MATCHED cannot MATCH or EXPIRE
    ['MATCHED', 'MATCH'],
    ['MATCHED', 'EXPIRE'],
  ];

  it.each(invalidCases)(
    '%s + %s → null',
    (current, event) => {
      expect(transitionIntent(current, event)).toBeNull();
    },
  );
});
