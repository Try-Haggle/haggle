import { describe, it, expect } from 'vitest';
import { assembleStageContext } from '../context.js';
import { GrokFastAdapter } from '../../adapters/grok-fast-adapter.js';
import { DefaultEngineSkill } from '../../skills/default-engine-skill.js';
import type { CoreMemory, OpponentPattern, L5Signals } from '../../types.js';
import { DEFAULT_BUDDY_DNA } from '../../config.js';

const adapter = new GrokFastAdapter();
const skill = new DefaultEngineSkill();

function makeMemory(overrides?: Partial<CoreMemory>): CoreMemory {
  return {
    session: {
      session_id: 'test-session-1',
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
      convergence_rate: 0.72,
      time_pressure: 0.3,
      utility_snapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_quality: 0.5, u_total: 0.6 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: DEFAULT_BUDDY_DNA,
    skill_summary: 'electronics-iphone-pro-v1',
    ...overrides,
  };
}

const defaultOpponent: OpponentPattern = {
  aggression: 0.5,
  concession_rate: 0.03,
  preferred_tactics: ['reciprocal_concession'],
  condition_flexibility: 0.5,
  estimated_floor: 88000,
};

describe('Stage 2: assembleStageContext', () => {
  it('returns layers, briefing, and memo_snapshot', () => {
    const memory = makeMemory();
    const result = assembleStageContext(
      {
        understood: { price_offer: 90000, action_intent: 'OFFER', conditions: {}, sentiment: 'neutral', raw_text: '' },
        memory,
        facts: [],
        opponent: defaultOpponent,
        skill,
      },
      adapter,
      'codec',
    );

    expect(result.layers).toBeDefined();
    expect(result.layers.L0_protocol).toBeTruthy();
    expect(result.layers.L1_model).toBeTruthy();
    expect(result.layers.L2_skill).toBeTruthy();
    expect(result.layers.L3_coaching).toBeTruthy();
    expect(result.briefing).toBeDefined();
    expect(result.briefing.opponentPattern).toBeDefined();
    expect(result.briefing.utilitySnapshot).toBeDefined();
    expect(result.memo_snapshot).toBeTruthy();
  });

  it('includes L5 signals when provided', () => {
    const memory = makeMemory();
    const l5Signals: L5Signals = {
      market: {
        avg_sold_price_30d: 87000,
        price_trend: 'stable',
        active_listings_count: 42,
        source_prices: [{ platform: 'Swappa', price: 87000 }],
      },
      competition: {
        concurrent_sessions: 3,
        best_competing_offer: 86000,
      },
    };

    const result = assembleStageContext(
      {
        understood: { price_offer: 90000, action_intent: 'OFFER', conditions: {}, sentiment: 'neutral', raw_text: '' },
        memory,
        facts: [],
        opponent: defaultOpponent,
        skill,
        l5_signals: l5Signals,
      },
      adapter,
      'codec',
    );

    expect(result.layers.L5_signals).toContain('MKT');
    expect(result.layers.L5_signals).toContain('87000');
  });

  it('uses codec encoding for memo snapshot', () => {
    const memory = makeMemory();
    const result = assembleStageContext(
      {
        understood: { price_offer: 90000, action_intent: 'OFFER', conditions: {}, sentiment: 'neutral', raw_text: '' },
        memory,
        facts: [],
        opponent: defaultOpponent,
        skill,
      },
      adapter,
      'codec',
    );

    // Codec format starts with NS:
    expect(result.memo_snapshot).toContain('NS:');
    expect(result.memo_snapshot).toContain('PT:');
  });

  it('uses raw encoding when specified', () => {
    const memory = makeMemory();
    const result = assembleStageContext(
      {
        understood: { price_offer: 90000, action_intent: 'OFFER', conditions: {}, sentiment: 'neutral', raw_text: '' },
        memory,
        facts: [],
        opponent: defaultOpponent,
        skill,
      },
      adapter,
      'raw',
    );

    // Raw format is JSON
    const parsed = JSON.parse(result.memo_snapshot);
    expect(parsed.session).toBeDefined();
    expect(parsed.boundaries).toBeDefined();
  });

  it('computes coaching with actual facts', () => {
    const memory = makeMemory({ session: { ...makeMemory().session, round: 4 } });
    const facts = [
      {
        round: 1, phase: 'BARGAINING' as const, buyer_offer: 85000, seller_offer: 92000, gap: 7000,
        conditions_changed: {}, coaching_given: { recommended: 87000, tactic: 'anchoring' },
        coaching_followed: true, human_intervened: false, timestamp: Date.now() - 3000,
      },
      {
        round: 2, phase: 'BARGAINING' as const, buyer_offer: 86000, seller_offer: 91000, gap: 5000,
        conditions_changed: {}, coaching_given: { recommended: 87000, tactic: 'reciprocal_concession' },
        coaching_followed: true, human_intervened: false, timestamp: Date.now() - 2000,
      },
    ];

    const result = assembleStageContext(
      {
        understood: { price_offer: 90000, action_intent: 'OFFER', conditions: {}, sentiment: 'neutral', raw_text: '' },
        memory,
        facts,
        opponent: defaultOpponent,
        skill,
      },
      adapter,
    );

    // Briefing provides gap trend instead of convergence rate
    expect(result.briefing.gapTrend).toBeDefined();
    expect(result.briefing.utilitySnapshot).toBeDefined();
  });
});
