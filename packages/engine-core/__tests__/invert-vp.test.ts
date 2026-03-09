import { describe, it, expect } from 'vitest';
import { invertVp } from '../src/utility/invert-vp.js';
import { computeVp } from '../src/utility/v-price.js';

describe('invertVp', () => {
  describe('buyer (p_target < p_limit)', () => {
    const p_target = 80;
    const p_limit = 120;

    it('returns p_target when vp_target = 1.0', () => {
      const price = invertVp(1.0, p_target, p_limit);
      expect(price).toBeCloseTo(p_target, 4);
    });

    it('returns p_limit when vp_target = 0.0', () => {
      const price = invertVp(0.0, p_target, p_limit);
      expect(price).toBeCloseTo(p_limit, 4);
    });

    it('returns intermediate price for vp_target = 0.5', () => {
      const price = invertVp(0.5, p_target, p_limit);
      expect(price).toBeGreaterThan(p_target);
      expect(price).toBeLessThan(p_limit);
    });

    it('round-trips with computeVp', () => {
      const testPrices = [85, 90, 95, 100, 105, 110, 115];
      for (const p of testPrices) {
        const vp = computeVp({ p_effective: p, p_target, p_limit });
        const recovered = invertVp(vp, p_target, p_limit);
        expect(recovered).toBeCloseTo(p, 4);
      }
    });
  });

  describe('seller (p_target > p_limit)', () => {
    const p_target = 120;
    const p_limit = 80;

    it('returns p_target when vp_target = 1.0', () => {
      const price = invertVp(1.0, p_target, p_limit);
      expect(price).toBeCloseTo(p_target, 4);
    });

    it('returns p_limit when vp_target = 0.0', () => {
      const price = invertVp(0.0, p_target, p_limit);
      expect(price).toBeCloseTo(p_limit, 4);
    });

    it('round-trips with computeVp for seller', () => {
      const testPrices = [85, 90, 95, 100, 105, 110, 115];
      for (const p of testPrices) {
        const vp = computeVp({ p_effective: p, p_target, p_limit });
        const recovered = invertVp(vp, p_target, p_limit);
        expect(recovered).toBeCloseTo(p, 4);
      }
    });
  });

  it('is a pure function (deterministic)', () => {
    const a = invertVp(0.5, 80, 120);
    const b = invertVp(0.5, 80, 120);
    expect(a).toBe(b);
  });
});
