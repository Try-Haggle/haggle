import { describe, expect, it } from 'vitest';
import { computeVp } from '../src/utility/v-price.js';

const TOL = 0.001;

describe('computeVp', () => {
  describe('buyer (p_target < p_limit)', () => {
    it('returns 0 when p_effective >= p_limit', () => {
      expect(computeVp({ p_effective: 220, p_target: 180, p_limit: 220 })).toBe(0);
      expect(computeVp({ p_effective: 250, p_target: 180, p_limit: 220 })).toBe(0);
    });

    it('returns ~1 when p_effective === p_target', () => {
      const vp = computeVp({ p_effective: 180, p_target: 180, p_limit: 220 });
      expect(Math.abs(vp - 1.0)).toBeLessThanOrEqual(TOL);
    });

    it('returns correct value for mid-range price', () => {
      // Test 1: p_effective=200, p_target=180, p_limit=220 → v_p ≈ 0.820
      const vp = computeVp({ p_effective: 200, p_target: 180, p_limit: 220 });
      expect(Math.abs(vp - 0.820)).toBeLessThanOrEqual(TOL);
    });

    it('returns value between 0 and 1', () => {
      const vp = computeVp({ p_effective: 210, p_target: 180, p_limit: 220 });
      expect(vp).toBeGreaterThan(0);
      expect(vp).toBeLessThan(1);
    });

    it('is concave (higher sensitivity near target)', () => {
      const base = { p_target: 100, p_limit: 200 };
      const vpNearTarget = computeVp({ ...base, p_effective: 110 });
      const vpMid = computeVp({ ...base, p_effective: 150 });
      const vpNearLimit = computeVp({ ...base, p_effective: 190 });
      expect(vpNearTarget).toBeGreaterThan(vpMid);
      expect(vpMid).toBeGreaterThan(vpNearLimit);
      expect(vpNearLimit).toBeGreaterThan(0);
    });
  });

  describe('seller (p_target > p_limit)', () => {
    it('returns 0 when p_effective <= p_limit', () => {
      expect(computeVp({ p_effective: 180, p_target: 220, p_limit: 180 })).toBe(0);
      expect(computeVp({ p_effective: 150, p_target: 220, p_limit: 180 })).toBe(0);
    });

    it('returns ~1 when p_effective === p_target', () => {
      const vp = computeVp({ p_effective: 220, p_target: 220, p_limit: 180 });
      expect(Math.abs(vp - 1.0)).toBeLessThanOrEqual(TOL);
    });

    it('returns correct value for mid-range price', () => {
      // Test 2: p_effective=210, p_target=220, p_limit=180 → v_p ≈ 0.925
      const vp = computeVp({ p_effective: 210, p_target: 220, p_limit: 180 });
      expect(Math.abs(vp - 0.925)).toBeLessThanOrEqual(TOL);
    });
  });
});
