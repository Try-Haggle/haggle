import { describe, expect, it } from 'vitest';
import { EngineError } from '../src/types.js';
import {
  validateContext,
  validatePriceContext,
  validateRelationshipContext,
  validateRiskContext,
  validateTimeContext,
  validateWeights,
} from '../src/validation.js';

describe('validateWeights', () => {
  it('accepts valid weights summing to 1.0', () => {
    expect(validateWeights({ w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 })).toBeNull();
  });

  it('accepts weights within tolerance (1e-6)', () => {
    expect(validateWeights({ w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1000009 })).toBeNull();
  });

  it('rejects weights that sum > 1.0 + tolerance', () => {
    expect(validateWeights({ w_p: 0.5, w_t: 0.3, w_r: 0.2, w_s: 0.1 })).toBe(EngineError.INVALID_WEIGHTS);
  });

  it('rejects weights that sum < 1.0 - tolerance', () => {
    expect(validateWeights({ w_p: 0.3, w_t: 0.3, w_r: 0.2, w_s: 0.1 })).toBe(EngineError.INVALID_WEIGHTS);
  });

  it('rejects negative weights', () => {
    expect(validateWeights({ w_p: -0.1, w_t: 0.5, w_r: 0.3, w_s: 0.3 })).toBe(EngineError.INVALID_WEIGHTS);
  });
});

describe('validatePriceContext', () => {
  it('accepts valid price context', () => {
    expect(validatePriceContext({ p_effective: 200, p_target: 180, p_limit: 220 })).toBeNull();
  });

  it('rejects p_target === p_limit', () => {
    expect(validatePriceContext({ p_effective: 200, p_target: 200, p_limit: 200 })).toBe(
      EngineError.ZERO_PRICE_RANGE,
    );
  });
});

describe('validateTimeContext', () => {
  it('accepts valid time context', () => {
    expect(validateTimeContext({ t_elapsed: 100, t_deadline: 1000, alpha: 1.0, v_t_floor: 0 })).toBeNull();
  });

  it('rejects t_deadline <= 0', () => {
    expect(validateTimeContext({ t_elapsed: 0, t_deadline: 0, alpha: 1.0, v_t_floor: 0 })).toBe(
      EngineError.INVALID_DEADLINE,
    );
  });

  it('rejects negative t_deadline', () => {
    expect(validateTimeContext({ t_elapsed: 0, t_deadline: -1, alpha: 1.0, v_t_floor: 0 })).toBe(
      EngineError.INVALID_DEADLINE,
    );
  });

  it('rejects alpha <= 0', () => {
    expect(validateTimeContext({ t_elapsed: 0, t_deadline: 1000, alpha: 0, v_t_floor: 0 })).toBe(
      EngineError.INVALID_ALPHA,
    );
  });
});

describe('validateRiskContext', () => {
  it('accepts valid risk context', () => {
    expect(validateRiskContext({ r_score: 0.5, i_completeness: 0.8, w_rep: 0.6, w_info: 0.4 })).toBeNull();
  });

  it('rejects r_score > 1', () => {
    expect(validateRiskContext({ r_score: 1.1, i_completeness: 0.5, w_rep: 0.6, w_info: 0.4 })).toBe(
      EngineError.INVALID_RISK_INPUT,
    );
  });

  it('rejects r_score < 0', () => {
    expect(validateRiskContext({ r_score: -0.1, i_completeness: 0.5, w_rep: 0.6, w_info: 0.4 })).toBe(
      EngineError.INVALID_RISK_INPUT,
    );
  });

  it('rejects i_completeness out of range', () => {
    expect(validateRiskContext({ r_score: 0.5, i_completeness: 1.5, w_rep: 0.6, w_info: 0.4 })).toBe(
      EngineError.INVALID_RISK_INPUT,
    );
  });
});

describe('validateRelationshipContext', () => {
  it('accepts valid relationship context', () => {
    expect(
      validateRelationshipContext({ n_success: 0, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5 }),
    ).toBeNull();
  });

  it('rejects n_threshold <= 0', () => {
    expect(
      validateRelationshipContext({ n_success: 0, n_dispute_losses: 0, n_threshold: 0, v_s_base: 0.5 }),
    ).toBe(EngineError.INVALID_THRESHOLD);
  });
});

describe('validateContext', () => {
  const validCtx = {
    weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
    price: { p_effective: 200, p_target: 180, p_limit: 220 },
    time: { t_elapsed: 100, t_deadline: 1000, alpha: 1.0, v_t_floor: 0 },
    risk: { r_score: 0.5, i_completeness: 0.5, w_rep: 0.6, w_info: 0.4 },
    relationship: { n_success: 0, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5 },
  };

  it('accepts fully valid context', () => {
    expect(validateContext(validCtx)).toBeNull();
  });

  it('returns first error found (weights)', () => {
    const ctx = { ...validCtx, weights: { w_p: 0.5, w_t: 0.5, w_r: 0.5, w_s: 0.5 } };
    expect(validateContext(ctx)?.error).toBe(EngineError.INVALID_WEIGHTS);
  });

  it('returns first error found (price)', () => {
    const ctx = { ...validCtx, price: { p_effective: 200, p_target: 200, p_limit: 200 } };
    expect(validateContext(ctx)?.error).toBe(EngineError.ZERO_PRICE_RANGE);
  });
});
