import { describe, expect, it } from 'vitest';
import { getStrategyTimeWindow, reconstructStrategy } from '../lib/session-reconstructor.js';

describe('session-reconstructor time value', () => {
  it('uses listing time_value as the negotiation clock', () => {
    const strategy = reconstructStrategy({
      p_target: 100_000,
      p_reservation: 80_000,
      alpha: { price: 0.4, time: 0.25, reputation: 0.2, satisfaction: 0.15 },
      concession: { beta: 0.8 },
      thresholds: { accept: 0.78, near_deal: 0.72 },
      time_value: {
        listed_at_ms: 1_000,
        deadline_at_ms: 11_000,
        t_total_ms: 10_000,
      },
    });

    expect(strategy.created_at).toBe(1_000);
    expect(strategy.expires_at).toBe(11_000);
    expect(strategy.t_deadline).toBe(10_000);
  });

  it('falls back to DB session timestamps when no listing time_value exists', () => {
    const window = getStrategyTimeWindow(
      { p_target: 100_000, p_reservation: 80_000 },
      2_000,
      8_000,
    );

    expect(window.startMs).toBe(2_000);
    expect(window.deadlineAtMs).toBe(8_000);
    expect(window.durationMs).toBe(6_000);
  });
});
