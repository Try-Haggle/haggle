import { describe, it, expect } from 'vitest';
import { dollarsToMinorUnits, minorUnitsToDollars } from '../src/index.js';

describe('price conversion', () => {
  describe('dollarsToMinorUnits', () => {
    it('converts whole dollars', () => {
      expect(dollarsToMinorUnits(25)).toBe(2500);
    });

    it('converts dollars with cents', () => {
      expect(dollarsToMinorUnits(25.99)).toBe(2599);
    });

    it('rounds half-cent values', () => {
      expect(dollarsToMinorUnits(25.995)).toBe(2600);
      expect(dollarsToMinorUnits(25.994)).toBe(2599);
    });

    it('handles zero', () => {
      expect(dollarsToMinorUnits(0)).toBe(0);
    });

    it('handles floating point edge cases', () => {
      // 0.1 + 0.2 = 0.30000000000000004
      expect(dollarsToMinorUnits(0.1 + 0.2)).toBe(30);
    });
  });

  describe('minorUnitsToDollars', () => {
    it('converts cents to dollars', () => {
      expect(minorUnitsToDollars(2500)).toBe(25.0);
    });

    it('converts with fractional cents', () => {
      expect(minorUnitsToDollars(2599)).toBe(25.99);
    });

    it('handles zero', () => {
      expect(minorUnitsToDollars(0)).toBe(0);
    });
  });

  describe('round-trip conversion', () => {
    it('dollars → minor → dollars is identity', () => {
      const original = 199.99;
      expect(minorUnitsToDollars(dollarsToMinorUnits(original))).toBe(original);
    });

    it('minor → dollars → minor is identity', () => {
      const original = 19999;
      expect(dollarsToMinorUnits(minorUnitsToDollars(original))).toBe(original);
    });
  });
});
