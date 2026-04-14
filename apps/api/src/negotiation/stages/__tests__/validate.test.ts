import { describe, it, expect } from 'vitest';
import { validateStage } from '../validate.js';
import type { ValidateInput } from '../../pipeline/types.js';
import type { CoreMemory, ProtocolDecision, RefereeCoaching } from '../../types.js';
import type { RefereeBriefing } from '../../skills/skill-types.js';
import { DEFAULT_BUDDY_DNA } from '../../config.js';

function makeCoaching(overrides?: Partial<RefereeCoaching>): RefereeCoaching {
  return {
    recommended_price: 87000,
    acceptable_range: { min: 83000, max: 95000 },
    suggested_tactic: 'reciprocal_concession',
    hint: '',
    opponent_pattern: 'LINEAR',
    convergence_rate: 0.5,
    time_pressure: 0.3,
    utility_snapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_quality: 0.5, u_total: 0.6 },
    strategic_hints: [],
    warnings: [],
    ...overrides,
  };
}

function makeBriefing(overrides?: Partial<RefereeBriefing>): RefereeBriefing {
  return {
    opponentPattern: 'LINEAR',
    timePressure: 0.3,
    gapTrend: [],
    opponentMoves: [],
    stagnation: false,
    utilitySnapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_total: 0.6 },
    warnings: [],
    ...overrides,
  };
}

function makeMemory(overrides?: Partial<CoreMemory>): CoreMemory {
  return {
    session: {
      session_id: 'test-session',
      phase: 'BARGAINING',
      round: 3,
      rounds_remaining: 7,
      role: 'buyer',
      max_rounds: 10,
      intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: 83000,
      my_floor: 95000,
      current_offer: 85000,
      opponent_offer: 90000,
      gap: 5000,
    },
    terms: { active: [], resolved_summary: '' },
    coaching: makeCoaching(),
    buddy_dna: DEFAULT_BUDDY_DNA,
    skill_summary: 'electronics-iphone-pro-v1',
    ...overrides,
  };
}

describe('Stage 4: validateStage', () => {
  it('passes valid decisions with no violations', () => {
    const result = validateStage(
      {
        decision: {
          decision: { action: 'COUNTER', price: 86000, reasoning: 'test', tactic_used: 'reciprocal_concession' },
          source: 'skill',
          reasoning_mode: false,
        },
        briefing: makeBriefing(),
        memory: makeMemory(),
        phase: 'BARGAINING',
      },
      [],
    );

    expect(result.validation.passed).toBe(true);
    expect(result.validation.hardPassed).toBe(true);
    expect(result.auto_fix_applied).toBe(false);
    expect(result.retry_count).toBe(0);
    expect(result.explainability.referee_result.action).toBe('PASS');
  });

  it('detects V1 HARD violation — buyer price exceeds floor', () => {
    const result = validateStage(
      {
        decision: {
          decision: { action: 'COUNTER', price: 96000, reasoning: 'test' },
          source: 'skill',
          reasoning_mode: false,
        },
        briefing: makeBriefing(),
        memory: makeMemory(),
        phase: 'BARGAINING',
      },
      [],
    );

    // V1 auto-fixed to floor
    expect(result.auto_fix_applied).toBe(true);
    expect(result.final_decision.price).toBe(95000);
    expect(result.explainability.referee_result.action).toBe('AUTO_FIX');
  });

  it('detects V2 HARD violation — wrong action for phase', () => {
    const result = validateStage(
      {
        decision: {
          decision: { action: 'COUNTER', price: 85000, reasoning: 'test' },
          source: 'skill',
          reasoning_mode: false,
        },
        briefing: makeBriefing(),
        memory: makeMemory(),
        phase: 'DISCOVERY',
      },
      [],
    );

    // V2 auto-fixed — COUNTER not allowed in DISCOVERY
    expect(result.auto_fix_applied).toBe(true);
    expect(result.final_decision.action).toBe('DISCOVER');
    expect(result.explainability.referee_result.violations.length).toBeGreaterThan(0);
  });

  it('detects V3 HARD violation — COUNTER with 0 rounds remaining', () => {
    const memory = makeMemory();
    memory.session.rounds_remaining = 0;

    const result = validateStage(
      {
        decision: {
          decision: { action: 'COUNTER', price: 86000, reasoning: 'test' },
          source: 'skill',
          reasoning_mode: false,
        },
        briefing: makeBriefing(),
        memory,
        phase: 'BARGAINING',
      },
      [],
    );

    expect(result.auto_fix_applied).toBe(true);
    expect(result.final_decision.action).toBe('ACCEPT');
  });

  it('detects SOFT violations without blocking', () => {
    // Create a stagnation scenario: 4+ previous moves with similar prices
    const previousMoves: ProtocolDecision[] = [
      { action: 'COUNTER', price: 85000, reasoning: 'test' },
      { action: 'COUNTER', price: 85100, reasoning: 'test' },
      { action: 'COUNTER', price: 85200, reasoning: 'test' },
      { action: 'COUNTER', price: 85300, reasoning: 'test' },
    ];

    const result = validateStage(
      {
        decision: {
          decision: { action: 'COUNTER', price: 85400, reasoning: 'test' },
          source: 'skill',
          reasoning_mode: false,
        },
        briefing: makeBriefing(),
        memory: makeMemory(),
        phase: 'BARGAINING',
      },
      previousMoves,
    );

    // SOFT violation V5 (stagnation) — warned but passed
    const softViolations = result.validation.violations.filter((v) => v.severity === 'SOFT');
    expect(softViolations.length).toBeGreaterThan(0);
    expect(result.validation.hardPassed).toBe(true);
    expect(result.explainability.referee_result.action).toBe('WARN_AND_PASS');
  });

  it('builds complete explainability structure', () => {
    const result = validateStage(
      {
        decision: {
          decision: { action: 'COUNTER', price: 86000, reasoning: 'Faratin curve', tactic_used: 'reciprocal_concession' },
          source: 'llm',
          reasoning_mode: true,
        },
        briefing: makeBriefing(),
        memory: makeMemory(),
        phase: 'BARGAINING',
      },
      [],
    );

    const exp = result.explainability;
    expect(exp.round).toBe(3);
    // Briefing is facts-only; coach_recommendation.price is now 0 (skill responsibility)
    expect(exp.coach_recommendation.price).toBe(0);
    expect(exp.decision.source).toBe('llm');
    expect(exp.decision.action).toBe('COUNTER');
    expect(exp.decision.price).toBe(86000);
    expect(exp.decision.tactic_used).toBe('reciprocal_concession');
    expect(exp.decision.reasoning_summary).toBe('Faratin curve');
    expect(exp.final_output.price).toBe(86000);
    expect(exp.final_output.action).toBe('COUNTER');
  });
});
