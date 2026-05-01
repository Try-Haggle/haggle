import { describe, expect, it } from 'vitest';
import { buildTimeValueWindow, computeTimeCurvePrice } from '../src/strategy/time-value.js';

describe('time value window', () => {
  it('computes continuous progress from listed time to deadline', () => {
    const listedAtMs = 1_000;
    const deadlineAtMs = 11_000;
    const window = buildTimeValueWindow({ listedAtMs, deadlineAtMs, nowMs: 6_000 });

    expect(window.totalMs).toBe(10_000);
    expect(window.elapsedMs).toBe(5_000);
    expect(window.remainingMs).toBe(5_000);
    expect(window.progress).toBe(0.5);
  });

  it('moves price along the Faratin curve as time passes', () => {
    const listedAtMs = 0;
    const deadlineAtMs = 100;
    const startPrice = 100_000;
    const limitPrice = 80_000;

    const today = computeTimeCurvePrice({
      startPrice,
      limitPrice,
      listedAtMs,
      deadlineAtMs,
      nowMs: 25,
      beta: 1,
    });
    const tomorrow = computeTimeCurvePrice({
      startPrice,
      limitPrice,
      listedAtMs,
      deadlineAtMs,
      nowMs: 75,
      beta: 1,
    });

    expect(today).toBe(95_000);
    expect(tomorrow).toBe(85_000);
    expect(tomorrow).toBeLessThan(today);
  });
});
