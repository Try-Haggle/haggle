import { describe, it, expect, vi } from 'vitest';
import { decide } from '../decide.js';
import { GrokFastAdapter } from '../../adapters/grok-fast-adapter.js';
import { DefaultEngineSkill } from '../../skills/default-engine-skill.js';
import type { CoreMemory, OpponentPattern, StageConfig, RefereeCoaching, ContextLayers } from '../../types.js';
import type { ContextOutput, DecideInput } from '../../pipeline/types.js';
import { DEFAULT_BUDDY_DNA } from '../../config.js';

const adapter = new GrokFastAdapter();
const skill = new DefaultEngineSkill();

function makeCoaching(): RefereeCoaching {
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
  };
}

function makeMemory(phase: CoreMemory['session']['phase'] = 'BARGAINING'): CoreMemory {
  return {
    session: {
      session_id: 'test-session',
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
    coaching: makeCoaching(),
    buddy_dna: DEFAULT_BUDDY_DNA,
    skill_summary: 'electronics-iphone-pro-v1',
  };
}

function makeConfig(): StageConfig {
  return {
    adapters: { UNDERSTAND: adapter, DECIDE: adapter, RESPOND: adapter },
    modes: { RESPOND: 'template', VALIDATE: 'full' },
    memoEncoding: 'codec',
    reasoningEnabled: true,
  };
}

function makeContextOutput(): ContextOutput {
  return {
    layers: {
      L0_protocol: 'protocol',
      L1_model: 'model',
      L2_skill: 'skill',
      L3_coaching: 'coaching',
      L4_history: '',
      L5_signals: '',
    },
    coaching: makeCoaching(),
    memo_snapshot: 'NS:BARGAINING',
  };
}

const defaultOpponent: OpponentPattern = {
  aggression: 0.5,
  concession_rate: 0.03,
  preferred_tactics: ['reciprocal_concession'],
  condition_flexibility: 0.5,
  estimated_floor: 88000,
};

describe('Stage 3: decide', () => {
  it('uses skill for non-BARGAINING phases', async () => {
    const memory = makeMemory('OPENING');
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: 'OPENING',
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(result.source).toBe('skill');
    expect(result.decision.action).toBe('COUNTER');
    expect(result.reasoning_mode).toBe(false);
  });

  it('uses skill for DISCOVERY phase', async () => {
    const memory = makeMemory('DISCOVERY');
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: 'DISCOVERY',
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(result.source).toBe('skill');
    expect(result.decision.action).toBe('DISCOVER');
  });

  it('uses skill for CLOSING phase', async () => {
    const memory = makeMemory('CLOSING');
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: 'CLOSING',
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(result.source).toBe('skill');
    expect(result.decision.action).toBe('CONFIRM');
  });

  it('falls back to skill when LLM fails in BARGAINING', async () => {
    // Mock callLLM to fail by using a mock module
    // Since we can't mock callLLM without full mock setup, test the skill fallback path
    const memory = makeMemory('BARGAINING');
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: 'BARGAINING',
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    // Without a real LLM, it should fall back to skill
    expect(result.source).toBe('skill');
    expect(result.decision).toBeDefined();
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns latency_ms', async () => {
    const memory = makeMemory('OPENING');
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: 'OPENING',
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(typeof result.latency_ms).toBe('number');
  });

  it('auto-accepts when gap is near zero', async () => {
    const memory = makeMemory('BARGAINING');
    memory.boundaries.current_offer = 89900;
    memory.boundaries.opponent_offer = 90000;
    memory.boundaries.gap = 100;

    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: 'BARGAINING',
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    // Near deal → skill should ACCEPT
    expect(result.decision.action).toBe('ACCEPT');
    expect(result.source).toBe('skill');
  });
});
