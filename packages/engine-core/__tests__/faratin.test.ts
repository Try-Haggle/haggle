import { describe, expect, it } from 'vitest';
import { computeCounterOffer } from '../src/decision/faratin.js';

const TOL = 0.01;

describe('computeCounterOffer (Faratin curve)', () => {
  it('returns p_start at t=0', () => {
    expect(computeCounterOffer({ p_start: 180, p_limit: 220, t: 0, T: 100, beta: 1.0 })).toBe(180);
  });

  it('returns p_limit at t=T', () => {
    expect(computeCounterOffer({ p_start: 180, p_limit: 220, t: 100, T: 100, beta: 1.0 })).toBe(220);
  });

  it('linear concession (beta=1.0) at midpoint', () => {
    // P(50) = 180 + (220 - 180) * (50/100)^1 = 180 + 20 = 200
    const p = computeCounterOffer({ p_start: 180, p_limit: 220, t: 50, T: 100, beta: 1.0 });
    expect(Math.abs(p - 200)).toBeLessThanOrEqual(TOL);
  });

  it('concave (beta=3.0) concedes slowly at first', () => {
    // P(50) = 180 + 40 * (0.5)^(1/3) ≈ 180 + 40 * 0.794 ≈ 211.75
    const p = computeCounterOffer({ p_start: 180, p_limit: 220, t: 50, T: 100, beta: 3.0 });
    expect(p).toBeGreaterThan(200); // concedes more than linear
  });

  it('convex (beta=0.5) concedes quickly at first', () => {
    // P(50) = 180 + 40 * (0.5)^2 = 180 + 10 = 190
    const p = computeCounterOffer({ p_start: 180, p_limit: 220, t: 50, T: 100, beta: 0.5 });
    expect(p).toBeLessThan(200); // concedes less than linear at midpoint
  });

  it('seller concession (p_start > p_limit)', () => {
    // Seller starts high, concedes down
    // P(50) = 220 + (180 - 220) * (0.5)^1 = 220 - 20 = 200
    const p = computeCounterOffer({ p_start: 220, p_limit: 180, t: 50, T: 100, beta: 1.0 });
    expect(Math.abs(p - 200)).toBeLessThanOrEqual(TOL);
  });

  it('clamps t/T to 1 when t > T', () => {
    const p = computeCounterOffer({ p_start: 180, p_limit: 220, t: 150, T: 100, beta: 1.0 });
    expect(p).toBe(220);
  });
});
