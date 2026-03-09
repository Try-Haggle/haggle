import { describe, it, expect } from 'vitest';
import { transitionCheckout, isTerminalCheckoutStatus } from '../src/index.js';

describe('transitionCheckout', () => {
  describe('from incomplete', () => {
    it('update → incomplete', () => {
      expect(transitionCheckout('incomplete', 'update')).toBe('incomplete');
    });
    it('escalate → requires_escalation', () => {
      expect(transitionCheckout('incomplete', 'escalate')).toBe('requires_escalation');
    });
    it('ready → ready_for_complete', () => {
      expect(transitionCheckout('incomplete', 'ready')).toBe('ready_for_complete');
    });
    it('cancel → canceled', () => {
      expect(transitionCheckout('incomplete', 'cancel')).toBe('canceled');
    });
    it('complete is not allowed', () => {
      expect(transitionCheckout('incomplete', 'complete')).toBeNull();
    });
  });

  describe('from requires_escalation', () => {
    it('resolve_escalation → incomplete', () => {
      expect(transitionCheckout('requires_escalation', 'resolve_escalation')).toBe('incomplete');
    });
    it('cancel → canceled', () => {
      expect(transitionCheckout('requires_escalation', 'cancel')).toBe('canceled');
    });
    it('update is not allowed', () => {
      expect(transitionCheckout('requires_escalation', 'update')).toBeNull();
    });
  });

  describe('from ready_for_complete', () => {
    it('complete → completed', () => {
      expect(transitionCheckout('ready_for_complete', 'complete')).toBe('completed');
    });
    it('cancel → canceled', () => {
      expect(transitionCheckout('ready_for_complete', 'cancel')).toBe('canceled');
    });
    it('update → incomplete (reverts)', () => {
      expect(transitionCheckout('ready_for_complete', 'update')).toBe('incomplete');
    });
  });

  describe('terminal states', () => {
    it('completed allows no transitions', () => {
      expect(transitionCheckout('completed', 'cancel')).toBeNull();
      expect(transitionCheckout('completed', 'update')).toBeNull();
    });
    it('canceled allows no transitions', () => {
      expect(transitionCheckout('canceled', 'update')).toBeNull();
      expect(transitionCheckout('canceled', 'complete')).toBeNull();
    });
  });
});

describe('isTerminalCheckoutStatus', () => {
  it('completed is terminal', () => {
    expect(isTerminalCheckoutStatus('completed')).toBe(true);
  });
  it('canceled is terminal', () => {
    expect(isTerminalCheckoutStatus('canceled')).toBe(true);
  });
  it('incomplete is not terminal', () => {
    expect(isTerminalCheckoutStatus('incomplete')).toBe(false);
  });
  it('ready_for_complete is not terminal', () => {
    expect(isTerminalCheckoutStatus('ready_for_complete')).toBe(false);
  });
});
