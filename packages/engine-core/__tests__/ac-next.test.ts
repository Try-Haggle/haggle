import { describe, it, expect } from 'vitest';
import { shouldAcceptNext } from '../src/decision/ac-next.js';

describe('shouldAcceptNext', () => {
  describe('buyer (p_target < p_limit)', () => {
    const p_target = 80;
    const p_limit = 120;

    it('accepts when incoming price is lower than counter', () => {
      expect(shouldAcceptNext(90, 95, p_target, p_limit)).toBe(true);
    });

    it('accepts when incoming price equals counter', () => {
      expect(shouldAcceptNext(95, 95, p_target, p_limit)).toBe(true);
    });

    it('rejects when incoming price is higher than counter', () => {
      expect(shouldAcceptNext(100, 95, p_target, p_limit)).toBe(false);
    });
  });

  describe('seller (p_target > p_limit)', () => {
    const p_target = 120;
    const p_limit = 80;

    it('accepts when incoming price is higher than counter', () => {
      expect(shouldAcceptNext(110, 105, p_target, p_limit)).toBe(true);
    });

    it('accepts when incoming price equals counter', () => {
      expect(shouldAcceptNext(105, 105, p_target, p_limit)).toBe(true);
    });

    it('rejects when incoming price is lower than counter', () => {
      expect(shouldAcceptNext(100, 105, p_target, p_limit)).toBe(false);
    });
  });

  it('is a pure function (deterministic)', () => {
    const a = shouldAcceptNext(90, 95, 80, 120);
    const b = shouldAcceptNext(90, 95, 80, 120);
    expect(a).toBe(b);
  });
});
