import { describe, it, expect } from 'vitest';
import { trackConcession } from '../src/round/concession.js';

describe('trackConcession', () => {
  describe('BUYER role', () => {
    it('raising price = concession (buyer moves toward seller)', () => {
      expect(trackConcession(90, 95, 'BUYER')).toBe(true);
    });

    it('lowering price = not concession (buyer moves away from seller)', () => {
      expect(trackConcession(95, 90, 'BUYER')).toBe(false);
    });

    it('same price = not concession', () => {
      expect(trackConcession(90, 90, 'BUYER')).toBe(false);
    });
  });

  describe('SELLER role', () => {
    it('lowering price = concession (seller moves toward buyer)', () => {
      expect(trackConcession(100, 95, 'SELLER')).toBe(true);
    });

    it('raising price = not concession (seller moves away from buyer)', () => {
      expect(trackConcession(95, 100, 'SELLER')).toBe(false);
    });

    it('same price = not concession', () => {
      expect(trackConcession(100, 100, 'SELLER')).toBe(false);
    });
  });
});
