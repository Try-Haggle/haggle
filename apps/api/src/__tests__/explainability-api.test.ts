import { describe, it, expect } from 'vitest';
import type { RoundExplainability } from '../negotiation/types.js';

/**
 * Explainability API tests.
 *
 * These test the data structures and transformation logic
 * without requiring a full Fastify server instance.
 * Integration tests covering the route handler are in negotiations.test.ts.
 */

describe('RoundExplainability structure', () => {
  it('validates a complete explainability object', () => {
    const explainability: RoundExplainability = {
      round: 3,
      coach_recommendation: {
        price: 58000,
        basis: 'reciprocal_concession',
        acceptable_range: { min: 50000, max: 65000 },
      },
      decision: {
        source: 'skill',
        price: 57000,
        action: 'COUNTER',
        tactic_used: 'reciprocal_concession',
        reasoning_summary: 'Counter-offer based on fair market value.',
      },
      referee_result: {
        violations: [],
        action: 'PASS',
        auto_fix_applied: false,
      },
      final_output: {
        price: 57000,
        action: 'COUNTER',
      },
    };

    expect(explainability.round).toBe(3);
    expect(explainability.coach_recommendation.price).toBe(58000);
    expect(explainability.decision.source).toBe('skill');
    expect(explainability.referee_result.action).toBe('PASS');
    expect(explainability.final_output.action).toBe('COUNTER');
  });

  it('supports violations in referee result', () => {
    const explainability: RoundExplainability = {
      round: 4,
      coach_recommendation: {
        price: 60000,
        basis: 'anchoring',
        acceptable_range: { min: 55000, max: 70000 },
      },
      decision: {
        source: 'llm',
        price: 45000,
        action: 'COUNTER',
        reasoning_summary: 'Price too aggressive.',
      },
      referee_result: {
        violations: [
          { rule: 'V2_PRICE_RANGE', severity: 'HARD', detail: 'Price below floor' },
          { rule: 'V6_STAGNATION', severity: 'SOFT', detail: 'No concession for 3 rounds' },
        ],
        action: 'AUTO_FIX',
        auto_fix_applied: true,
      },
      final_output: {
        price: 55000,
        action: 'COUNTER',
      },
    };

    expect(explainability.referee_result.violations).toHaveLength(2);
    expect(explainability.referee_result.action).toBe('AUTO_FIX');
    expect(explainability.referee_result.auto_fix_applied).toBe(true);
    expect(explainability.final_output.price).toBe(55000);
  });
});

describe('Decisions response format', () => {
  it('builds decisions array from round metadata', () => {
    // Simulate extracting explainability from round metadata
    const roundMetadata = [
      { tactic: 'anchoring', reasoning: 'opening', engine: 'staged-pipeline', explainability: {
        round: 1,
        coach_recommendation: { price: 50000, basis: 'test', acceptable_range: { min: 40000, max: 60000 } },
        decision: { source: 'skill', action: 'COUNTER', reasoning_summary: 'opening' },
        referee_result: { violations: [], action: 'PASS', auto_fix_applied: false },
        final_output: { price: 50000, action: 'COUNTER' },
      }},
      { tactic: 'concession', reasoning: 'mid', engine: 'staged-pipeline', explainability: {
        round: 2,
        coach_recommendation: { price: 55000, basis: 'test', acceptable_range: { min: 45000, max: 60000 } },
        decision: { source: 'skill', action: 'COUNTER', reasoning_summary: 'mid game' },
        referee_result: { violations: [], action: 'PASS', auto_fix_applied: false },
        final_output: { price: 55000, action: 'COUNTER' },
      }},
      { tactic: 'unknown', reasoning: 'legacy', engine: 'llm' },  // No explainability (legacy)
    ];

    const decisions = roundMetadata
      .map((meta) => meta.explainability)
      .filter((d): d is NonNullable<typeof d> => d != null);

    expect(decisions).toHaveLength(2);
    expect(decisions[0]!.round).toBe(1);
    expect(decisions[1]!.round).toBe(2);
  });

  it('returns empty array when no staged rounds exist', () => {
    const roundMetadata = [
      { tactic: 'unknown', reasoning: 'legacy', engine: 'llm' },
    ];

    const decisions = roundMetadata
      .map((meta) => (meta as Record<string, unknown>).explainability)
      .filter((d): d is NonNullable<typeof d> => d != null);

    expect(decisions).toHaveLength(0);
  });
});
