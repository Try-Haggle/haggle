import { describe, it, expect } from 'vitest';
import { tryTransition, isTerminal, getValidEvents, detectPhaseEvent } from '../phase-machine.js';

describe('PhaseMachine', () => {
  describe('tryTransition', () => {
    it('should transition DISCOVERY → OPENING on INITIAL_OFFER_MADE', () => {
      const result = tryTransition('DISCOVERY', 'INITIAL_OFFER_MADE');
      expect(result.transitioned).toBe(true);
      expect(result.from).toBe('DISCOVERY');
      expect(result.to).toBe('OPENING');
    });

    it('should transition OPENING → BARGAINING on COUNTER_OFFER_MADE', () => {
      const result = tryTransition('OPENING', 'COUNTER_OFFER_MADE');
      expect(result.transitioned).toBe(true);
      expect(result.to).toBe('BARGAINING');
    });

    it('should transition BARGAINING → CLOSING on NEAR_DEAL_DETECTED', () => {
      const result = tryTransition('BARGAINING', 'NEAR_DEAL_DETECTED');
      expect(result.transitioned).toBe(true);
      expect(result.to).toBe('CLOSING');
    });

    it('should transition CLOSING → SETTLEMENT on BOTH_CONFIRMED', () => {
      const result = tryTransition('CLOSING', 'BOTH_CONFIRMED');
      expect(result.transitioned).toBe(true);
      expect(result.to).toBe('SETTLEMENT');
    });

    it('should allow BARGAINING → OPENING revert', () => {
      const result = tryTransition('BARGAINING', 'REVERT_REQUESTED');
      expect(result.transitioned).toBe(true);
      expect(result.to).toBe('OPENING');
    });

    it('should allow CLOSING → BARGAINING revert', () => {
      const result = tryTransition('CLOSING', 'REVERT_REQUESTED');
      expect(result.transitioned).toBe(true);
      expect(result.to).toBe('BARGAINING');
    });

    it('should not transition from SETTLEMENT', () => {
      const result = tryTransition('SETTLEMENT', 'COUNTER_OFFER_MADE');
      expect(result.transitioned).toBe(false);
      expect(result.to).toBe('SETTLEMENT');
    });

    it('should handle invalid event gracefully', () => {
      const result = tryTransition('DISCOVERY', 'BOTH_CONFIRMED');
      expect(result.transitioned).toBe(false);
    });

    it('should transition to SETTLEMENT on ABORT from any non-terminal phase', () => {
      for (const phase of ['DISCOVERY', 'OPENING', 'BARGAINING', 'CLOSING'] as const) {
        const result = tryTransition(phase, 'ABORT');
        expect(result.transitioned).toBe(true);
        expect(result.to).toBe('SETTLEMENT');
      }
    });

    it('should transition on TIMEOUT', () => {
      expect(tryTransition('DISCOVERY', 'TIMEOUT').to).toBe('OPENING');
      expect(tryTransition('OPENING', 'TIMEOUT').to).toBe('BARGAINING');
      expect(tryTransition('BARGAINING', 'TIMEOUT').to).toBe('CLOSING');
      expect(tryTransition('CLOSING', 'TIMEOUT').to).toBe('SETTLEMENT');
    });
  });

  describe('isTerminal', () => {
    it('should identify SETTLEMENT as terminal', () => {
      expect(isTerminal('SETTLEMENT')).toBe(true);
    });

    it('should not identify other phases as terminal', () => {
      for (const phase of ['DISCOVERY', 'OPENING', 'BARGAINING', 'CLOSING'] as const) {
        expect(isTerminal(phase)).toBe(false);
      }
    });
  });

  describe('getValidEvents', () => {
    it('should return valid events for DISCOVERY', () => {
      const events = getValidEvents('DISCOVERY');
      expect(events).toContain('INITIAL_OFFER_MADE');
      expect(events).toContain('TIMEOUT');
      expect(events).toContain('ABORT');
    });

    it('should return empty array for SETTLEMENT', () => {
      expect(getValidEvents('SETTLEMENT')).toHaveLength(0);
    });
  });

  describe('detectPhaseEvent', () => {
    it('should detect INITIAL_OFFER_MADE in DISCOVERY', () => {
      expect(detectPhaseEvent('COUNTER', 'DISCOVERY', false, false)).toBe('INITIAL_OFFER_MADE');
    });

    it('should detect COUNTER_OFFER_MADE in OPENING', () => {
      expect(detectPhaseEvent('COUNTER', 'OPENING', false, false)).toBe('COUNTER_OFFER_MADE');
    });

    it('should detect NEAR_DEAL_DETECTED in BARGAINING', () => {
      expect(detectPhaseEvent('COUNTER', 'BARGAINING', true, false)).toBe('NEAR_DEAL_DETECTED');
    });

    it('should detect BOTH_CONFIRMED in CLOSING', () => {
      expect(detectPhaseEvent('CONFIRM', 'CLOSING', false, true)).toBe('BOTH_CONFIRMED');
    });

    it('should return null when no event detected', () => {
      expect(detectPhaseEvent('HOLD', 'BARGAINING', false, false)).toBeNull();
    });
  });
});
