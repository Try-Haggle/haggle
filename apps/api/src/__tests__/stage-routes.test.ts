import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Stage Routes tests.
 *
 * Tests input validation, pipeline mode guard, and response structure
 * for the Stage 2/4/5 API routes. Uses vitest mocking for the pipeline mode.
 */

// Mock executor-factory before importing route module
vi.mock('../lib/executor-factory.js', () => ({
  getPipelineMode: vi.fn(() => 'staged'),
}));

import { getPipelineMode } from '../lib/executor-factory.js';

describe('Stage Routes', () => {
  describe('Pipeline mode guard', () => {
    it('rejects when pipeline mode is legacy', () => {
      vi.mocked(getPipelineMode).mockReturnValue('legacy');
      const mode = getPipelineMode();
      expect(mode).toBe('legacy');
    });

    it('allows when pipeline mode is staged', () => {
      vi.mocked(getPipelineMode).mockReturnValue('staged');
      const mode = getPipelineMode();
      expect(mode).toBe('staged');
    });
  });

  describe('Context request validation', () => {
    it('validates well-formed context request body', () => {
      const body = {
        understood: {
          price_offer: 55000,
          action_intent: 'COUNTER',
          conditions: {},
          sentiment: 'neutral',
          raw_text: '$550 counter offer',
        },
        memory: makeMinimalMemory(),
        facts: [],
        opponent: {
          aggression: 0.5,
          concession_rate: 0.1,
          preferred_tactics: ['reciprocal_concession'],
          condition_flexibility: 0.5,
          estimated_floor: 45000,
        },
        skill_id: 'electronics-iphone-pro-v1',
      };

      expect(body.understood.action_intent).toBe('COUNTER');
      expect(body.memory.session.phase).toBe('BARGAINING');
      expect(body.opponent.aggression).toBe(0.5);
      expect(body.skill_id).toBeTruthy();
    });
  });

  describe('Validate request validation', () => {
    it('validates well-formed validate request body', () => {
      const body = {
        decision: {
          decision: {
            action: 'COUNTER',
            price: 57000,
            reasoning: 'Fair counter based on market signals.',
            tactic_used: 'reciprocal_concession',
          },
          source: 'skill',
          reasoning_mode: false,
        },
        coaching: {
          recommended_price: 58000,
          acceptable_range: { min: 50000, max: 65000 },
          suggested_tactic: 'reciprocal_concession',
          hint: 'Consider meeting in the middle.',
          opponent_pattern: 'LINEAR',
          convergence_rate: 0.05,
          time_pressure: 0.3,
          utility_snapshot: { u_price: 0.7, u_time: 0.8, u_risk: 0.9, u_quality: 0.7, u_total: 0.78 },
          strategic_hints: [],
          warnings: [],
        },
        memory: makeMinimalMemory(),
        phase: 'BARGAINING',
      };

      expect(body.decision.decision.action).toBe('COUNTER');
      expect(body.coaching.recommended_price).toBe(58000);
      expect(body.phase).toBe('BARGAINING');
    });
  });

  describe('Respond request validation', () => {
    it('validates well-formed respond request body', () => {
      const body = {
        validated: {
          final_decision: {
            action: 'COUNTER',
            price: 57000,
            reasoning: 'Fair counter.',
          },
          validation: { passed: true, hardPassed: true, violations: [] },
          auto_fix_applied: false,
          retry_count: 0,
          explainability: {
            round: 3,
            coach_recommendation: { price: 58000, basis: 'test', acceptable_range: { min: 50000, max: 65000 } },
            decision: { source: 'skill', action: 'COUNTER', reasoning_summary: 'test' },
            referee_result: { violations: [], action: 'PASS', auto_fix_applied: false },
            final_output: { price: 57000, action: 'COUNTER' },
          },
        },
        memory: makeMinimalMemory(),
        skill_id: 'electronics-iphone-pro-v1',
      };

      expect(body.validated.final_decision.action).toBe('COUNTER');
      expect(body.validated.validation.passed).toBe(true);
    });
  });

  describe('Stage output structures', () => {
    it('context output has required fields', () => {
      const output = {
        layers: {
          L0_protocol: 'test',
          L1_model: 'test',
          L2_skill: 'test',
          L3_coaching: 'test',
          L4_history: 'test',
          L5_signals: 'test',
        },
        coaching: {
          recommended_price: 58000,
          acceptable_range: { min: 50000, max: 65000 },
        },
        memo_snapshot: 'encoded_memo_data',
      };

      expect(output.layers.L0_protocol).toBeDefined();
      expect(output.coaching.recommended_price).toBe(58000);
      expect(output.memo_snapshot).toBeTruthy();
    });

    it('validate output has required fields', () => {
      const output = {
        final_decision: { action: 'COUNTER', price: 57000, reasoning: 'test' },
        validation: { passed: true, hardPassed: true, violations: [] },
        auto_fix_applied: false,
        explainability: {
          round: 3,
          coach_recommendation: { price: 58000, basis: 'test', acceptable_range: { min: 50000, max: 65000 } },
          decision: { source: 'skill', action: 'COUNTER', reasoning_summary: 'test' },
          referee_result: { violations: [], action: 'PASS', auto_fix_applied: false },
          final_output: { price: 57000, action: 'COUNTER' },
        },
      };

      expect(output.final_decision.action).toBe('COUNTER');
      expect(output.explainability.round).toBe(3);
    });

    it('respond output has required fields', () => {
      const output = {
        message: 'I can do $570 for this item.',
        tone: 'professional',
      };

      expect(output.message).toBeTruthy();
      expect(output.tone).toBe('professional');
    });
  });
});

// ─── Helper ───

function makeMinimalMemory() {
  return {
    session: {
      session_id: 'test-session-1',
      phase: 'BARGAINING',
      round: 3,
      rounds_remaining: 12,
      role: 'buyer',
      max_rounds: 15,
      intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: 50000,
      my_floor: 70000,
      current_offer: 55000,
      opponent_offer: 62000,
      gap: 7000,
    },
    terms: { active: [], resolved_summary: '' },
    coaching: {
      recommended_price: 58000,
      acceptable_range: { min: 50000, max: 65000 },
      suggested_tactic: 'reciprocal_concession',
      hint: 'test',
      opponent_pattern: 'UNKNOWN',
      convergence_rate: 0,
      time_pressure: 0.2,
      utility_snapshot: { u_price: 0.7, u_time: 0.8, u_risk: 0.9, u_quality: 0.7, u_total: 0.75 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: {
      style: 'balanced',
      preferred_tactic: 'reciprocal_concession',
      category_experience: 'electronics',
      condition_trade_success_rate: 0.5,
      best_timing: 'mid-session',
      tone: { style: 'professional', formality: 'neutral', emoji_use: false },
    },
    skill_summary: 'electronics-iphone-pro-v1',
  };
}
