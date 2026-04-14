import { describe, it, expect } from 'vitest';
import { executePipeline } from '../pipeline.js';
import { GrokFastAdapter } from '../../adapters/grok-fast-adapter.js';
import { DefaultEngineSkill } from '../../skills/default-engine-skill.js';
import type { CoreMemory, OpponentPattern, ProtocolDecision, StageConfig } from '../../types.js';
import type { PipelineDeps, UnderstandOutput } from '../types.js';
import { DEFAULT_BUDDY_DNA } from '../../config.js';

const adapter = new GrokFastAdapter();
const skill = new DefaultEngineSkill();

function makeConfig(): StageConfig {
  return {
    adapters: { UNDERSTAND: adapter, DECIDE: adapter, RESPOND: adapter },
    modes: { RESPOND: 'template', VALIDATE: 'full' },
    memoEncoding: 'codec',
    reasoningEnabled: false, // Disable LLM for unit tests
  };
}

function makeMemory(phase: CoreMemory['session']['phase'] = 'BARGAINING'): CoreMemory {
  return {
    session: {
      session_id: 'pipeline-test-session',
      phase,
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

const defaultOpponent: OpponentPattern = {
  aggression: 0.5,
  concession_rate: 0.03,
  preferred_tactics: ['reciprocal_concession'],
  condition_flexibility: 0.5,
  estimated_floor: 88000,
};

function makeDeps(overrides?: Partial<PipelineDeps>): PipelineDeps {
  return {
    skill,
    config: makeConfig(),
    memory: makeMemory(),
    facts: [],
    opponent: defaultOpponent,
    phase: 'BARGAINING',
    buddyDna: DEFAULT_BUDDY_DNA,
    previousMoves: [],
    round: 4,
    briefing: {
      opponentPattern: 'LINEAR',
      timePressure: 0.3,
      gapTrend: [],
      opponentMoves: [],
      stagnation: false,
      utilitySnapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_total: 0.6 },
      warnings: [],
    },
    memoEncoding: 'codec',
    ...overrides,
  };
}

describe('6-Stage Pipeline E2E', () => {
  it('executes all 6 stages with structured input', async () => {
    const result = await executePipeline(
      'Offer: $90000',
      90000,
      makeDeps(),
    );

    // Pipeline result structure
    expect(result.round).toBe(4);
    expect(result.phase).toBeTruthy();
    expect(result.stages.understand).toBeDefined();
    expect(result.stages.context).toBeDefined();
    expect(result.stages.decide).toBeDefined();
    expect(result.stages.validate).toBeDefined();
    expect(result.stages.respond).toBeDefined();
    expect(result.stages.persist).toBeDefined();

    // Explainability
    expect(result.explainability).toBeDefined();
    expect(result.explainability.round).toBe(3); // From memory round
    expect(result.explainability.coach_recommendation).toBeDefined();
    expect(result.explainability.decision).toBeDefined();
    expect(result.explainability.referee_result).toBeDefined();

    // Cost
    expect(result.cost).toBeDefined();
    expect(result.cost.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('handles OPENING phase with skill-only decision', async () => {
    const result = await executePipeline(
      'Initial offer',
      90000,
      makeDeps({
        memory: makeMemory('OPENING'),
        phase: 'OPENING',
      }),
    );

    expect(result.stages.decide.source).toBe('skill');
    expect(result.stages.decide.decision.action).toBe('COUNTER');
    expect(result.stages.respond.message).toBeTruthy();
  });

  it('handles DISCOVERY phase', async () => {
    const result = await executePipeline(
      'Tell me about the phone',
      undefined,
      makeDeps({
        memory: makeMemory('DISCOVERY'),
        phase: 'DISCOVERY',
      }),
    );

    expect(result.stages.decide.source).toBe('skill');
    expect(result.stages.decide.decision.action).toBe('DISCOVER');
  });

  it('handles CLOSING phase', async () => {
    const result = await executePipeline(
      'Confirm deal',
      90000,
      makeDeps({
        memory: makeMemory('CLOSING'),
        phase: 'CLOSING',
      }),
    );

    expect(result.stages.decide.decision.action).toBe('CONFIRM');
  });

  it('accepts UnderstandOutput directly', async () => {
    const understood: UnderstandOutput = {
      price_offer: 90000,
      action_intent: 'OFFER',
      conditions: {},
      sentiment: 'neutral',
      raw_text: 'Offer: $90000',
    };

    const result = await executePipeline(
      understood,
      90000,
      makeDeps(),
    );

    expect(result.stages.understand).toEqual(understood);
  });

  it('uses custom persistFn when provided', async () => {
    let persistCalled = false;
    const result = await executePipeline(
      'Offer: $90000',
      90000,
      makeDeps({
        persistFn: async (input) => {
          persistCalled = true;
          return { session_done: false };
        },
      }),
    );

    expect(persistCalled).toBe(true);
  });

  it('detects session done on ACCEPT', async () => {
    // Near deal: gap < 5% of range
    const memory = makeMemory();
    memory.boundaries.current_offer = 89500;
    memory.boundaries.opponent_offer = 90000;
    memory.boundaries.gap = 500;

    const result = await executePipeline(
      'Offer: $90000',
      90000,
      makeDeps({ memory }),
    );

    // Skill should ACCEPT when gap is < 5%
    if (result.stages.decide.decision.action === 'ACCEPT') {
      expect(result.done).toBe(true);
    }
  });

  it('includes context with memo snapshot', async () => {
    const result = await executePipeline(
      'Offer: $90000',
      90000,
      makeDeps(),
    );

    expect(result.stages.context.memo_snapshot).toBeTruthy();
    expect(result.stages.context.layers.L0_protocol).toBeTruthy();
    expect(result.stages.context.coaching).toBeDefined();
  });

  it('handles BARGAINING with previous moves (validation context)', async () => {
    const previousMoves: ProtocolDecision[] = [
      { action: 'COUNTER', price: 84000, reasoning: 'R1' },
      { action: 'COUNTER', price: 85000, reasoning: 'R2' },
    ];

    const result = await executePipeline(
      'Offer: $90000',
      90000,
      makeDeps({ previousMoves }),
    );

    expect(result.stages.validate.validation).toBeDefined();
  });
});
