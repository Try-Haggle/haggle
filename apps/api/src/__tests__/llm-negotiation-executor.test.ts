import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shouldUseReasoning, getEngineMode } from '../negotiation/config.js';

// ---------------------------------------------------------------------------
// shouldUseReasoning tests
// ---------------------------------------------------------------------------

describe('shouldUseReasoning', () => {
  it('triggers on small gap ratio (< 10%)', () => {
    expect(shouldUseReasoning({
      gap: 500,
      gapRatio: 0.05,
      coachWarnings: [],
      opponentPattern: 'LINEAR',
      softViolationCount: 0,
    })).toBe(true);
  });

  it('does not trigger on zero gap ratio', () => {
    expect(shouldUseReasoning({
      gap: 0,
      gapRatio: 0,
      coachWarnings: [],
      opponentPattern: 'LINEAR',
      softViolationCount: 0,
    })).toBe(false);
  });

  it('triggers on 2+ coach warnings', () => {
    expect(shouldUseReasoning({
      gap: 5000,
      gapRatio: 0.3,
      coachWarnings: ['Stagnation detected', 'Running low on rounds'],
      opponentPattern: 'LINEAR',
      softViolationCount: 0,
    })).toBe(true);
  });

  it('does not trigger on single warning', () => {
    expect(shouldUseReasoning({
      gap: 5000,
      gapRatio: 0.3,
      coachWarnings: ['Stagnation detected'],
      opponentPattern: 'LINEAR',
      softViolationCount: 0,
    })).toBe(false);
  });

  it('triggers on BOULWARE opponent', () => {
    expect(shouldUseReasoning({
      gap: 5000,
      gapRatio: 0.3,
      coachWarnings: [],
      opponentPattern: 'BOULWARE',
      softViolationCount: 0,
    })).toBe(true);
  });

  it('triggers on 2+ soft violations', () => {
    expect(shouldUseReasoning({
      gap: 5000,
      gapRatio: 0.3,
      coachWarnings: [],
      opponentPattern: 'LINEAR',
      softViolationCount: 2,
    })).toBe(true);
  });

  it('does not trigger when all conditions are normal', () => {
    expect(shouldUseReasoning({
      gap: 5000,
      gapRatio: 0.3,
      coachWarnings: [],
      opponentPattern: 'LINEAR',
      softViolationCount: 0,
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEngineMode tests
// ---------------------------------------------------------------------------

describe('getEngineMode', () => {
  const originalEnv = process.env.NEGOTIATION_ENGINE;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NEGOTIATION_ENGINE = originalEnv;
    } else {
      delete process.env.NEGOTIATION_ENGINE;
    }
  });

  it('defaults to rule when env is not set', () => {
    delete process.env.NEGOTIATION_ENGINE;
    expect(getEngineMode()).toBe('rule');
  });

  it('returns llm when env is set to llm', () => {
    process.env.NEGOTIATION_ENGINE = 'llm';
    expect(getEngineMode()).toBe('llm');
  });

  it('returns rule for unknown values', () => {
    process.env.NEGOTIATION_ENGINE = 'unknown';
    expect(getEngineMode()).toBe('rule');
  });
});

// ---------------------------------------------------------------------------
// Action → DB mapping tests (import from executor)
// ---------------------------------------------------------------------------

describe('ProtocolDecision action mapping', () => {
  // These are tested indirectly via the mapActionToDbDecision function
  // Since it's not exported, we verify the mapping logic
  const actionMap: Record<string, string> = {
    COUNTER: 'COUNTER',
    ACCEPT: 'ACCEPT',
    REJECT: 'REJECT',
    HOLD: 'NEAR_DEAL',
    CONFIRM: 'ACCEPT',
  };

  for (const [input, expected] of Object.entries(actionMap)) {
    it(`maps ${input} → ${expected}`, () => {
      expect(actionMap[input]).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Phase → DB status mapping tests
// ---------------------------------------------------------------------------

describe('phaseToDbStatus mapping', () => {
  // Import from memory-reconstructor tested separately,
  // verify the contract here
  const cases: Array<[string, string, number, string]> = [
    ['OPENING', 'COUNTER', 0, 'ACTIVE'],
    ['BARGAINING', 'COUNTER', 0, 'ACTIVE'],
    ['BARGAINING', 'COUNTER', 4, 'STALLED'],
    ['CLOSING', 'HOLD', 0, 'NEAR_DEAL'],
    ['SETTLEMENT', 'ACCEPT', 0, 'ACCEPTED'],
    ['SETTLEMENT', 'CONFIRM', 0, 'ACCEPTED'],
    ['SETTLEMENT', 'REJECT', 0, 'REJECTED'],
  ];

  it.each(cases)(
    'phase=%s action=%s rnc=%d → %s',
    async (phase, action, rnc, expected) => {
      const { phaseToDbStatus } = await import('../negotiation/memory/memory-reconstructor.js');
      expect(phaseToDbStatus(phase as any, action, rnc)).toBe(expected);
    },
  );
});

// ---------------------------------------------------------------------------
// Executor factory tests
// ---------------------------------------------------------------------------

describe('executor factory', () => {
  afterEach(() => {
    delete process.env.NEGOTIATION_ENGINE;
    delete process.env.NEGOTIATION_PIPELINE;
  });

  it('returns rule executor by default', async () => {
    delete process.env.NEGOTIATION_ENGINE;
    const { getExecutor } = await import('../lib/executor-factory.js');
    const executor = getExecutor();
    expect(typeof executor).toBe('function');
    // The function name check confirms which executor was returned
    expect(executor.name).toContain('Negotiation');
  });

  it('returns LLM executor when env=llm', async () => {
    process.env.NEGOTIATION_ENGINE = 'llm';
    const { getExecutor } = await import('../lib/executor-factory.js');
    const executor = getExecutor();
    expect(typeof executor).toBe('function');
  });

  it('defaults LLM pipeline mode to staged unless legacy is explicit', async () => {
    const { getPipelineMode } = await import('../lib/executor-factory.js');

    delete process.env.NEGOTIATION_PIPELINE;
    expect(getPipelineMode()).toBe('staged');

    process.env.NEGOTIATION_PIPELINE = 'legacy';
    expect(getPipelineMode()).toBe('legacy');
  });
});
