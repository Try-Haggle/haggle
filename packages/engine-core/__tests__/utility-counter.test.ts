import { describe, it, expect } from 'vitest';
import { computeUtilitySpaceCounterOffer } from '../src/decision/utility-counter.js';

function makeParams(overrides?: Record<string, unknown>) {
  return {
    u_aspiration: 0.8,
    u_threshold: 0.4,
    t: 1800,
    T: 3600,
    beta: 1.5,
    weights: { w_p: 0.4, w_t: 0.2, w_r: 0.2, w_s: 0.2 },
    v_t: 0.7,
    v_r: 0.8,
    v_s: 0.6,
    p_target: 80,
    p_limit: 120,
    ...overrides,
  };
}

describe('computeUtilitySpaceCounterOffer', () => {
  it('returns a price within buyer range (p_target < p_limit)', () => {
    const price = computeUtilitySpaceCounterOffer(makeParams());
    expect(price).toBeGreaterThanOrEqual(80);
    expect(price).toBeLessThanOrEqual(120);
  });

  it('returns a price within seller range (p_target > p_limit)', () => {
    const price = computeUtilitySpaceCounterOffer(makeParams({
      p_target: 120,
      p_limit: 80,
    }));
    expect(price).toBeGreaterThanOrEqual(80);
    expect(price).toBeLessThanOrEqual(120);
  });

  it('starts near target price at t=0', () => {
    const price = computeUtilitySpaceCounterOffer(makeParams({ t: 0 }));
    // At t=0, U_target = u_aspiration, so v_p should be high → price near p_target
    expect(price).toBeLessThan(100); // closer to 80 than 120 for buyer
  });

  it('concedes more as time progresses', () => {
    const early = computeUtilitySpaceCounterOffer(makeParams({ t: 600 }));
    const late = computeUtilitySpaceCounterOffer(makeParams({ t: 3000 }));
    // Buyer: higher price = more concession
    expect(late).toBeGreaterThan(early);
  });

  it('concedes faster with higher beta (matching Faratin convention)', () => {
    const lowBeta = computeUtilitySpaceCounterOffer(makeParams({ beta: 0.5 }));
    const highBeta = computeUtilitySpaceCounterOffer(makeParams({ beta: 3.0 }));
    // In the (t/T)^(1/β) formula: higher β → smaller exponent → faster concession
    // Buyer: faster concession → higher price (closer to p_limit)
    expect(highBeta).toBeGreaterThan(lowBeta);
  });

  it('accounts for non-price utility dimensions', () => {
    // High non-price utility → less pressure on price → can ask better price
    const highNonPrice = computeUtilitySpaceCounterOffer(makeParams({
      v_t: 0.9, v_r: 0.9, v_s: 0.9,
    }));
    const lowNonPrice = computeUtilitySpaceCounterOffer(makeParams({
      v_t: 0.2, v_r: 0.2, v_s: 0.2,
    }));
    // With higher non-price utility, buyer needs less v_p → can accept higher price
    // But actually higher non-price means v_p_target is lower → price is higher for buyer
    // Wait: lower v_p_target means price is worse (closer to limit)
    // Actually for buyer: lower v_p → price closer to limit (higher)
    expect(highNonPrice).toBeGreaterThan(lowNonPrice);
  });

  it('handles t >= T by clamping ratio to 1', () => {
    const atDeadline = computeUtilitySpaceCounterOffer(makeParams({ t: 3600 }));
    const pastDeadline = computeUtilitySpaceCounterOffer(makeParams({ t: 5000 }));
    expect(pastDeadline).toBeCloseTo(atDeadline, 4);
  });

  it('returns p_target when w_p = 0 (degenerate case)', () => {
    const price = computeUtilitySpaceCounterOffer(makeParams({
      weights: { w_p: 0, w_t: 0.4, w_r: 0.3, w_s: 0.3 },
    }));
    expect(price).toBe(80);
  });

  it('is a pure function (deterministic)', () => {
    const params = makeParams();
    const a = computeUtilitySpaceCounterOffer(params);
    const b = computeUtilitySpaceCounterOffer(params);
    expect(a).toBe(b);
  });
});
