import { describe, it, expect } from 'vitest';
import { classifyMove } from '../src/round/classify-move.js';
import type { NegotiationRange } from '../src/round/types.js';

const range: NegotiationRange = { p_target: 80, p_limit: 120 };

describe('classifyMove', () => {
  it('classifies buyer raising price as CONCESSION', () => {
    const move = classifyMove(90, 95, 'BUYER', range);
    expect(move.type).toBe('CONCESSION');
    expect(move.magnitude).toBeCloseTo(5 / 40, 6);
  });

  it('classifies buyer lowering price as SELFISH', () => {
    const move = classifyMove(95, 90, 'BUYER', range);
    expect(move.type).toBe('SELFISH');
    expect(move.magnitude).toBeCloseTo(5 / 40, 6);
  });

  it('classifies seller lowering price as CONCESSION', () => {
    const move = classifyMove(110, 105, 'SELLER', range);
    expect(move.type).toBe('CONCESSION');
    expect(move.magnitude).toBeCloseTo(5 / 40, 6);
  });

  it('classifies seller raising price as SELFISH', () => {
    const move = classifyMove(105, 110, 'SELLER', range);
    expect(move.type).toBe('SELFISH');
    expect(move.magnitude).toBeCloseTo(5 / 40, 6);
  });

  it('classifies unchanged price as SILENT', () => {
    const move = classifyMove(100, 100, 'BUYER', range);
    expect(move.type).toBe('SILENT');
    expect(move.magnitude).toBe(0);
  });

  it('classifies near-zero change as SILENT', () => {
    const move = classifyMove(100, 100 + 1e-8, 'BUYER', range);
    expect(move.type).toBe('SILENT');
    expect(move.magnitude).toBe(0);
  });

  it('caps magnitude at 1.0 for moves larger than range', () => {
    const move = classifyMove(50, 100, 'BUYER', range);
    expect(move.type).toBe('CONCESSION');
    expect(move.magnitude).toBe(1);
  });

  it('handles zero-width range gracefully', () => {
    const zeroRange: NegotiationRange = { p_target: 100, p_limit: 100 };
    const move = classifyMove(100, 105, 'BUYER', zeroRange);
    expect(move.magnitude).toBe(0);
  });

  it('handles seller-side range (p_target > p_limit)', () => {
    const sellerRange: NegotiationRange = { p_target: 120, p_limit: 80 };
    const move = classifyMove(110, 105, 'SELLER', sellerRange);
    expect(move.type).toBe('CONCESSION');
    expect(move.magnitude).toBeCloseTo(5 / 40, 6);
  });
});
