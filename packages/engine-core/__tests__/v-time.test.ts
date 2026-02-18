import { describe, expect, it } from 'vitest';
import { computeVt } from '../src/utility/v-time.js';

const TOL = 0.001;

describe('computeVt', () => {
  it('returns 1.0 at t_elapsed = 0', () => {
    expect(computeVt({ t_elapsed: 0, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0 })).toBe(1.0);
  });

  it('returns 0.0 at t_elapsed >= t_deadline (no floor)', () => {
    expect(computeVt({ t_elapsed: 86400, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0 })).toBe(0.0);
  });

  it('returns correct linear decay (alpha=1.0)', () => {
    // Test 1: t_elapsed=36000, t_deadline=86400, alpha=1.0 → v_t ≈ 0.583
    const vt = computeVt({ t_elapsed: 36000, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0 });
    expect(Math.abs(vt - 0.583)).toBeLessThanOrEqual(TOL);
  });

  it('returns correct cubic decay (alpha=3.0)', () => {
    // Test 2: t_elapsed=7200, t_deadline=604800, alpha=3.0 → v_t ≈ 0.965
    const vt = computeVt({ t_elapsed: 7200, t_deadline: 604800, alpha: 3.0, v_t_floor: 0.0 });
    expect(Math.abs(vt - 0.965)).toBeLessThanOrEqual(TOL);
  });

  it('respects v_t_floor', () => {
    // Even at deadline, floor keeps v_t from going to 0
    const vt = computeVt({ t_elapsed: 86400, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.8 });
    expect(vt).toBe(0.8);
  });

  it('returns floor when raw is below floor', () => {
    const vt = computeVt({ t_elapsed: 80000, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.5 });
    expect(vt).toBe(0.5);
  });

  it('returns raw when raw is above floor', () => {
    const vt = computeVt({ t_elapsed: 0, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.5 });
    expect(vt).toBe(1.0);
  });

  it('handles alpha=0.5 (convex, fast initial decay)', () => {
    const vt = computeVt({ t_elapsed: 43200, t_deadline: 86400, alpha: 0.5, v_t_floor: 0.0 });
    // (0.5)^0.5 ≈ 0.707
    expect(Math.abs(vt - 0.707)).toBeLessThanOrEqual(TOL);
  });

  it('handles overtime (t_elapsed > t_deadline)', () => {
    const vt = computeVt({ t_elapsed: 100000, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0 });
    expect(vt).toBe(0.0);
  });
});
