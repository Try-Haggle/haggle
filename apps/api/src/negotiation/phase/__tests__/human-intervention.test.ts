import { describe, it, expect } from 'vitest';
import { checkIntervention, applyHumanOverride } from '../human-intervention.js';
import type { ProtocolDecision } from '../../types.js';

const COUNTER: ProtocolDecision = { action: 'COUNTER', price: 540, reasoning: 'test' };
const ACCEPT: ProtocolDecision = { action: 'ACCEPT', price: 600, reasoning: 'accepting' };
const CONFIRM: ProtocolDecision = { action: 'CONFIRM', price: 600, reasoning: 'confirming' };

describe('checkIntervention', () => {
  it('FULL_AUTO — always approves', () => {
    expect(checkIntervention(COUNTER, 'BARGAINING', 'FULL_AUTO').autoApproved).toBe(true);
    expect(checkIntervention(ACCEPT, 'BARGAINING', 'FULL_AUTO').autoApproved).toBe(true);
  });

  it('MANUAL — always requires approval', () => {
    const result = checkIntervention(COUNTER, 'BARGAINING', 'MANUAL');
    expect(result.autoApproved).toBe(false);
    expect(result.pendingReview).toBeDefined();
    expect(result.pendingReview!.reason).toContain('Manual');
  });

  it('APPROVE_ONLY — approves COUNTER, blocks ACCEPT', () => {
    expect(checkIntervention(COUNTER, 'BARGAINING', 'APPROVE_ONLY').autoApproved).toBe(true);
    const acceptResult = checkIntervention(ACCEPT, 'BARGAINING', 'APPROVE_ONLY');
    expect(acceptResult.autoApproved).toBe(false);
    expect(acceptResult.pendingReview!.reason).toContain('ACCEPT');
  });

  it('APPROVE_ONLY — blocks CONFIRM', () => {
    const result = checkIntervention(CONFIRM, 'CLOSING', 'APPROVE_ONLY');
    expect(result.autoApproved).toBe(false);
  });

  it('HYBRID — uses default config', () => {
    // Default: DISCOVERY auto, OPENING manual, BARGAINING auto, CLOSING manual
    expect(checkIntervention(COUNTER, 'DISCOVERY', 'HYBRID').autoApproved).toBe(true);
    expect(checkIntervention(COUNTER, 'OPENING', 'HYBRID').autoApproved).toBe(false);
    expect(checkIntervention(COUNTER, 'BARGAINING', 'HYBRID').autoApproved).toBe(true);
    expect(checkIntervention(COUNTER, 'CLOSING', 'HYBRID').autoApproved).toBe(false);
  });

  it('HYBRID — respects custom config', () => {
    const config = { DISCOVERY: 'manual' as const, BARGAINING: 'manual' as const };
    expect(checkIntervention(COUNTER, 'DISCOVERY', 'HYBRID', config).autoApproved).toBe(false);
    expect(checkIntervention(COUNTER, 'BARGAINING', 'HYBRID', config).autoApproved).toBe(false);
  });
});

describe('applyHumanOverride', () => {
  it('should merge override into decision', () => {
    const result = applyHumanOverride(COUNTER, { price: 560 });
    expect(result.price).toBe(560);
    expect(result.action).toBe('COUNTER');
    expect(result.reasoning).toContain('[Human Override]');
  });

  it('should preserve override reasoning', () => {
    const result = applyHumanOverride(COUNTER, { reasoning: 'I want higher' });
    expect(result.reasoning).toContain('I want higher');
    expect(result.reasoning).toContain('[Human Override]');
  });

  it('should override action', () => {
    const result = applyHumanOverride(COUNTER, { action: 'ACCEPT' });
    expect(result.action).toBe('ACCEPT');
  });
});
