import { describe, it, expect } from 'vitest';
import { computeDynamicBeta } from '../src/decision/dynamic-beta.js';

describe('computeDynamicBeta', () => {
  it('returns beta_base when no competition or opponent data', () => {
    const result = computeDynamicBeta({ beta_base: 1.5 });
    expect(result).toBeCloseTo(1.5, 6);
  });

  it('returns beta_base with explicit zeros', () => {
    const result = computeDynamicBeta({
      beta_base: 1.5,
      n_competitors: 0,
      opponent_concession_rate: 0,
    });
    expect(result).toBeCloseTo(1.5, 6);
  });

  it('increases beta with more competitors', () => {
    const base = computeDynamicBeta({ beta_base: 1.5 });
    const withComp = computeDynamicBeta({ beta_base: 1.5, n_competitors: 5 });
    expect(withComp).toBeGreaterThan(base);
  });

  it('increases beta when opponent is conceding (positive rate)', () => {
    const base = computeDynamicBeta({ beta_base: 1.5 });
    const withConcession = computeDynamicBeta({
      beta_base: 1.5,
      opponent_concession_rate: 0.5,
    });
    expect(withConcession).toBeGreaterThan(base);
  });

  it('decreases beta when opponent is rigid (negative rate)', () => {
    const base = computeDynamicBeta({ beta_base: 1.5 });
    const withRigid = computeDynamicBeta({
      beta_base: 1.5,
      opponent_concession_rate: -0.5,
    });
    expect(withRigid).toBeLessThan(base);
  });

  it('combines competition and opponent effects', () => {
    // beta_competition = 1.5 * (1 + 0.5 * ln(4)) ≈ 1.5 * (1 + 0.693) ≈ 2.54
    // beta_dynamic = 2.54 * (1 + 0.3 * 0.5) = 2.54 * 1.15 ≈ 2.92
    const result = computeDynamicBeta({
      beta_base: 1.5,
      n_competitors: 3,
      opponent_concession_rate: 0.5,
      kappa: 0.5,
      lambda: 0.3,
    });
    expect(result).toBeGreaterThan(2.5);
    expect(result).toBeLessThan(3.5);
  });

  it('clamps to minimum 0.1', () => {
    const result = computeDynamicBeta({
      beta_base: 0.2,
      opponent_concession_rate: -0.9,
      lambda: 1.0,
    });
    expect(result).toBeGreaterThanOrEqual(0.1);
  });

  it('clamps to maximum 10.0', () => {
    const result = computeDynamicBeta({
      beta_base: 5.0,
      n_competitors: 100,
      opponent_concession_rate: 1.0,
      kappa: 1.0,
      lambda: 1.0,
    });
    expect(result).toBeLessThanOrEqual(10.0);
  });

  it('respects custom kappa and lambda', () => {
    const defaultResult = computeDynamicBeta({
      beta_base: 1.0,
      n_competitors: 5,
      opponent_concession_rate: 0.5,
    });
    const customResult = computeDynamicBeta({
      beta_base: 1.0,
      n_competitors: 5,
      opponent_concession_rate: 0.5,
      kappa: 1.0,
      lambda: 0.8,
    });
    // Higher kappa and lambda should amplify the effect
    expect(customResult).toBeGreaterThan(defaultResult);
  });

  it('is a pure function (deterministic)', () => {
    const params = { beta_base: 1.5, n_competitors: 3, opponent_concession_rate: 0.4 };
    const a = computeDynamicBeta(params);
    const b = computeDynamicBeta(params);
    expect(a).toBe(b);
  });

  it('handles single competitor correctly', () => {
    // ln(1+1) = ln(2) ≈ 0.693
    // beta = 1.0 * (1 + 0.5 * 0.693) ≈ 1.347
    const result = computeDynamicBeta({ beta_base: 1.0, n_competitors: 1 });
    expect(result).toBeCloseTo(1.0 * (1 + 0.5 * Math.log(2)), 4);
  });
});
