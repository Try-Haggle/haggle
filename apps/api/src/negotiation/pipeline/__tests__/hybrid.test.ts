import { describe, it, expect } from 'vitest';
import { understand, understandFromStructured, assembleStageContext, validateStage, respond } from '../../stages/index.js';
import { GrokFastAdapter } from '../../adapters/grok-fast-adapter.js';
import { DefaultEngineSkill } from '../../skills/default-engine-skill.js';
import type { CoreMemory, OpponentPattern, StageConfig } from '../../types.js';
import { DEFAULT_BUDDY_DNA } from '../../config.js';

const adapter = new GrokFastAdapter();
const skill = new DefaultEngineSkill();

function makeMemory(): CoreMemory {
  return {
    session: {
      session_id: 'hybrid-test',
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
    coaching: {
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
    },
    buddy_dna: DEFAULT_BUDDY_DNA,
    skill_summary: 'electronics-iphone-pro-v1',
  };
}

function makeConfig(): StageConfig {
  return {
    adapters: { UNDERSTAND: adapter, DECIDE: adapter, RESPOND: adapter },
    modes: { RESPOND: 'template', VALIDATE: 'full' },
    memoEncoding: 'codec',
    reasoningEnabled: false,
  };
}

const defaultOpponent: OpponentPattern = {
  aggression: 0.5,
  concession_rate: 0.03,
  preferred_tactics: ['reciprocal_concession'],
  condition_flexibility: 0.5,
  estimated_floor: 88000,
};

describe('Hybrid: External agent cherry-picks stages', () => {
  it('can call Stage 1 (Understand) independently', () => {
    const result = understand({
      raw_message: 'How about $850 for this iPhone?',
      sender_role: 'buyer',
    });

    expect(result.price_offer).toBe(850);
    expect(result.action_intent).toBe('COUNTER');
    expect(result.sentiment).toBe('neutral');
  });

  it('can call Stage 2 (Context) independently', () => {
    const memory = makeMemory();
    const result = assembleStageContext(
      {
        understood: understandFromStructured(90000, 'seller'),
        memory,
        facts: [],
        opponent: defaultOpponent,
        skill,
      },
      adapter,
      'codec',
    );

    expect(result.layers).toBeDefined();
    expect(result.briefing).toBeDefined();
    expect(result.briefing.opponentPattern).toBeDefined();
    expect(result.memo_snapshot).toContain('NS:');
  });

  it('can call Stage 4 (Validate) independently with external decision', () => {
    const externalDecision = {
      decision: { action: 'COUNTER' as const, price: 86000, reasoning: 'External agent decision' },
      source: 'llm' as const,
      reasoning_mode: false,
    };

    const result = validateStage(
      {
        decision: externalDecision,
        briefing: {
          opponentPattern: 'LINEAR',
          timePressure: 0.3,
          gapTrend: [],
          opponentMoves: [],
          stagnation: false,
          utilitySnapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_total: 0.6 },
          warnings: [],
        },
        memory: makeMemory(),
        phase: 'BARGAINING',
      },
      [],
    );

    expect(result.validation.passed).toBe(true);
    expect(result.explainability.decision.source).toBe('llm');
    expect(result.explainability.decision.reasoning_summary).toBe('External agent decision');
  });

  it('can call Stage 5 (Respond) independently', () => {
    const result = respond({
      validated: {
        final_decision: { action: 'COUNTER', price: 86000, reasoning: 'test' },
        validation: { passed: true, hardPassed: true, violations: [] },
        auto_fix_applied: false,
        retry_count: 0,
        explainability: {
          round: 3,
          coach_recommendation: { price: 87000, basis: 'test', acceptable_range: { min: 83000, max: 95000 } },
          decision: { source: 'skill', action: 'COUNTER', reasoning_summary: 'test' },
          referee_result: { violations: [], action: 'PASS', auto_fix_applied: false },
          final_output: { action: 'COUNTER', price: 86000 },
        },
      },
      memory: makeMemory(),
      adapter,
      skill,
      config: makeConfig(),
    });

    expect(result.message).toContain('$86000');
    expect(result.tone).toBe('professional');
  });

  it('simulates Stage 2 → Stage 4 → Stage 5 cherry-pick flow', () => {
    const memory = makeMemory();

    // Agent calls Stage 2
    const context = assembleStageContext(
      {
        understood: understandFromStructured(90000, 'seller'),
        memory,
        facts: [],
        opponent: defaultOpponent,
        skill,
      },
      adapter,
    );

    // Agent makes its own decision (skips Stage 3)
    const agentDecision = {
      decision: { action: 'COUNTER' as const, price: 87500, reasoning: 'Agent custom strategy' },
      source: 'llm' as const,
      reasoning_mode: false,
    };

    // Agent calls Stage 4
    const validation = validateStage(
      {
        decision: agentDecision,
        briefing: context.briefing,
        memory,
        phase: 'BARGAINING',
      },
      [],
    );

    expect(validation.validation.passed).toBe(true);

    // Agent calls Stage 5
    const response = respond({
      validated: validation,
      memory,
      adapter,
      skill,
      config: makeConfig(),
    });

    expect(response.message).toContain('$87500');
  });
});
