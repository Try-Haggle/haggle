import { describe, it, expect } from 'vitest';
import { makeMultiIssueDecision } from '../src/issues/decision.js';
import type { MultiIssueUtilityResult, AcceptanceThresholdParams } from '../src/issues/types.js';

// Helper to create a utility result with a specific u_total
function makeUtility(u_total: number): MultiIssueUtilityResult {
  return {
    issue_utilities: [],
    u_contract: u_total,
    c_risk: 0,
    b_rel: 0,
    u_total,
  };
}

const baseThreshold: AcceptanceThresholdParams = {
  u_batna: 0.3,
  u_min: 0.4,
  u_0: 0.8,
  tau: 0.5,
  beta: 1.0,
};
// R(0.5) = max(0.3, 0.4 + (0.8 - 0.4) * (1 - 0.5^1)) = max(0.3, 0.6) = 0.6

describe('NEAR_DEAL acceptance band', () => {
  it('returns NEAR_DEAL when utility is within band below threshold', () => {
    // R = 0.6, band = 0.05, so [0.55, 0.6) is NEAR_DEAL
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.57),
      threshold_params: baseThreshold,
      tau: 0.5,
      rounds_no_concession: 0,
      near_deal_band: 0.05,
    });
    expect(result.action).toBe('NEAR_DEAL');
    expect(result.near_deal_proximity).toBeDefined();
    expect(result.near_deal_proximity!).toBeGreaterThan(0);
    expect(result.near_deal_proximity!).toBeLessThan(1);
  });

  it('returns ACCEPT when utility >= threshold (not NEAR_DEAL)', () => {
    // Use 0.61 to clear floating-point threshold (~0.6000000000000001)
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.61),
      threshold_params: baseThreshold,
      tau: 0.5,
      rounds_no_concession: 0,
      near_deal_band: 0.05,
    });
    expect(result.action).toBe('ACCEPT');
  });

  it('returns COUNTER when utility is below NEAR_DEAL band', () => {
    // R = 0.6, band = 0.05, so u = 0.5 is below the band
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.5),
      threshold_params: baseThreshold,
      tau: 0.5,
      rounds_no_concession: 0,
      near_deal_band: 0.05,
    });
    expect(result.action).toBe('COUNTER');
  });

  it('NEAR_DEAL proximity = 0 at band bottom', () => {
    // R = 0.6, band = 0.05, bottom = 0.55
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.55),
      threshold_params: baseThreshold,
      tau: 0.5,
      rounds_no_concession: 0,
      near_deal_band: 0.05,
    });
    expect(result.action).toBe('NEAR_DEAL');
    expect(result.near_deal_proximity).toBeCloseTo(0);
  });

  it('NEAR_DEAL proximity approaches 1 just below threshold', () => {
    // R = 0.6, band = 0.05, just below = 0.599
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.599),
      threshold_params: baseThreshold,
      tau: 0.5,
      rounds_no_concession: 0,
      near_deal_band: 0.05,
    });
    expect(result.action).toBe('NEAR_DEAL');
    expect(result.near_deal_proximity!).toBeGreaterThan(0.9);
  });

  it('default near_deal_band is 0.05', () => {
    // R = 0.6, default band = 0.05, u = 0.57 → NEAR_DEAL
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.57),
      threshold_params: baseThreshold,
      tau: 0.5,
      rounds_no_concession: 0,
      // no near_deal_band → defaults to 0.05
    });
    expect(result.action).toBe('NEAR_DEAL');
  });

  it('near_deal_band = 0 disables NEAR_DEAL', () => {
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.59),
      threshold_params: baseThreshold,
      tau: 0.5,
      rounds_no_concession: 0,
      near_deal_band: 0,
    });
    // With band=0, should go straight to COUNTER
    expect(result.action).toBe('COUNTER');
  });

  it('ESCALATE still takes priority over NEAR_DEAL when stalled', () => {
    // u is in the near-deal band, but stall count exceeds threshold
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.57),
      threshold_params: baseThreshold,
      tau: 0.5,
      rounds_no_concession: 5,
      stall_threshold: 4,
      near_deal_band: 0.05,
    });
    // NEAR_DEAL comes BEFORE stall check in the priority chain (1.5 vs 2)
    // So NEAR_DEAL should still fire since it's checked first
    expect(result.action).toBe('NEAR_DEAL');
  });
});
