import { describe, expect, it } from 'vitest';
import { makeDecision } from '../src/decision/maker.js';
import type { UtilityResult } from '../src/types.js';
import type { DecisionThresholds, SessionState } from '../src/decision/types.js';

function makeUtility(u_total: number, v_t: number = 0.5): UtilityResult {
  return { u_total, v_p: 0, v_t, v_r: 0, v_s: 0 };
}

const thresholds: DecisionThresholds = { u_threshold: 0.6, u_aspiration: 0.85 };
const normalSession: SessionState = { rounds_no_concession: 0 };

describe('makeDecision', () => {
  it('ACCEPT when u >= u_aspiration', () => {
    const d = makeDecision(makeUtility(0.9), thresholds, normalSession);
    expect(d.action).toBe('ACCEPT');
  });

  it('ACCEPT when u >= u_aspiration (exact)', () => {
    const d = makeDecision(makeUtility(0.85), thresholds, normalSession);
    expect(d.action).toBe('ACCEPT');
  });

  it('ACCEPT when u >= u_threshold and v_t < 0.1 (deadline pressure)', () => {
    const d = makeDecision(makeUtility(0.7, 0.05), thresholds, normalSession);
    expect(d.action).toBe('ACCEPT');
  });

  it('NEAR_DEAL when u >= u_threshold (normal time)', () => {
    const d = makeDecision(makeUtility(0.7, 0.5), thresholds, normalSession);
    expect(d.action).toBe('NEAR_DEAL');
  });

  it('NEAR_DEAL at exact threshold', () => {
    const d = makeDecision(makeUtility(0.6, 0.5), thresholds, normalSession);
    expect(d.action).toBe('NEAR_DEAL');
  });

  it('ESCALATE when stalled (4+ rounds no concession)', () => {
    const d = makeDecision(makeUtility(0.4, 0.5), thresholds, { rounds_no_concession: 4 });
    expect(d.action).toBe('ESCALATE');
  });

  it('ESCALATE when deadline imminent and below threshold', () => {
    const d = makeDecision(makeUtility(0.3, 0.04), thresholds, normalSession);
    expect(d.action).toBe('ESCALATE');
  });

  it('COUNTER when u > 0 but below threshold', () => {
    const d = makeDecision(makeUtility(0.3, 0.5), thresholds, normalSession);
    expect(d.action).toBe('COUNTER');
  });

  it('REJECT when u <= 0', () => {
    const d = makeDecision(makeUtility(0, 0.5), thresholds, normalSession);
    expect(d.action).toBe('REJECT');
  });

  it('priority: aspiration > deadline-accept', () => {
    // u >= aspiration AND v_t < 0.1 → ACCEPT (via aspiration path, not deadline)
    const d = makeDecision(makeUtility(0.9, 0.05), thresholds, normalSession);
    expect(d.action).toBe('ACCEPT');
  });

  it('priority: stalled > deadline-escalate', () => {
    // rounds >= 4 AND v_t < 0.05 → ESCALATE (via stalled path)
    const d = makeDecision(makeUtility(0.3, 0.04), thresholds, { rounds_no_concession: 5 });
    expect(d.action).toBe('ESCALATE');
  });
});
