import { describe, it, expect } from 'vitest';
import { generateStrategy } from '../../src/negotiation/strategy-gen.js';
import { validateStrategy } from '@haggle/engine-session';
import type { ListingContext, PersonaPreset } from '../../src/negotiation/types.js';

function makeListing(overrides?: Partial<ListingContext>): ListingContext {
  return {
    listing_id: 'lst_1',
    title: 'Test Item',
    target_price: 100,
    floor_price: 70,
    condition: 'good',
    seller_id: 'seller_1',
    ...overrides,
  };
}

describe('generateStrategy', () => {
  describe('SELLER role', () => {
    it('should set p_target = listing target_price', () => {
      const strategy = generateStrategy(makeListing(), 'SELLER');
      expect(strategy.p_target).toBe(100);
    });

    it('should set p_limit = listing floor_price', () => {
      const strategy = generateStrategy(makeListing(), 'SELLER');
      expect(strategy.p_limit).toBe(70);
    });
  });

  describe('BUYER role', () => {
    it('should set p_target < listing target_price', () => {
      const strategy = generateStrategy(makeListing(), 'BUYER');
      expect(strategy.p_target).toBeLessThan(100);
    });

    it('should set p_limit < listing target_price', () => {
      const strategy = generateStrategy(makeListing(), 'BUYER');
      expect(strategy.p_limit).toBeLessThan(100);
    });

    it('should apply higher discount for poor condition vs new', () => {
      const newStrategy = generateStrategy(makeListing({ condition: 'new' }), 'BUYER');
      const poorStrategy = generateStrategy(makeListing({ condition: 'poor' }), 'BUYER');
      // Poor condition → larger discount → lower target
      expect(poorStrategy.p_target).toBeLessThan(newStrategy.p_target);
    });

    it('should apply condition-specific limit fractions', () => {
      const newStrategy = generateStrategy(makeListing({ condition: 'new' }), 'BUYER');
      const poorStrategy = generateStrategy(makeListing({ condition: 'poor' }), 'BUYER');
      // Poor condition → lower limit fraction → lower p_limit
      expect(poorStrategy.p_limit).toBeLessThan(newStrategy.p_limit);
    });
  });

  describe('persona mapping', () => {
    it('should map balanced to beta=1.0', () => {
      const strategy = generateStrategy(makeListing(), 'BUYER', 'balanced');
      expect(strategy.beta).toBe(1.0);
    });

    it('should map aggressive to beta=0.5', () => {
      const strategy = generateStrategy(makeListing(), 'BUYER', 'aggressive');
      expect(strategy.beta).toBe(0.5);
    });

    it('should map conservative to beta=2.0', () => {
      const strategy = generateStrategy(makeListing(), 'BUYER', 'conservative');
      expect(strategy.beta).toBe(2.0);
    });

    it('should default to balanced persona when not specified', () => {
      const strategy = generateStrategy(makeListing(), 'BUYER');
      expect(strategy.beta).toBe(1.0);
      expect(strategy.persona).toBe('balanced');
    });
  });

  describe('defaults and validation', () => {
    it('should have weights summing to 1.0', () => {
      const strategy = generateStrategy(makeListing(), 'BUYER');
      const { w_p, w_t, w_r, w_s } = strategy.weights;
      expect(w_p + w_t + w_r + w_s).toBeCloseTo(1.0);
    });

    it('should set expires_at - created_at = t_deadline * 1000', () => {
      const strategy = generateStrategy(makeListing(), 'BUYER');
      expect(strategy.expires_at - strategy.created_at).toBe(strategy.t_deadline * 1000);
    });

    it('should pass validateStrategy()', () => {
      const conditions: ListingContext['condition'][] = ['new', 'like_new', 'good', 'fair', 'poor'];
      const roles: Array<'BUYER' | 'SELLER'> = ['BUYER', 'SELLER'];
      const personas: PersonaPreset[] = ['balanced', 'aggressive', 'conservative'];

      for (const condition of conditions) {
        for (const role of roles) {
          for (const persona of personas) {
            const strategy = generateStrategy(makeListing({ condition }), role, persona);
            strategy.user_id = 'test_user';
            const error = validateStrategy(strategy);
            expect(error, `Failed: ${condition}/${role}/${persona}`).toBeNull();
          }
        }
      }
    });

    it('should have all numeric fields > 0', () => {
      const strategy = generateStrategy(makeListing(), 'BUYER');
      expect(strategy.p_target).toBeGreaterThan(0);
      expect(strategy.p_limit).toBeGreaterThan(0);
      expect(strategy.alpha).toBeGreaterThan(0);
      expect(strategy.beta).toBeGreaterThan(0);
      expect(strategy.t_deadline).toBeGreaterThan(0);
    });
  });
});
