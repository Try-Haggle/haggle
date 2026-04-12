import { describe, it, expect } from 'vitest';
import {
  getPresetForAmount,
  getPresetByName,
  PIPELINE_PRESETS,
} from '../pipeline-presets.js';

describe('pipeline-presets', () => {
  describe('getPresetForAmount', () => {
    it('should return quick for $0', () => {
      const preset = getPresetForAmount(0);
      expect(preset.name).toBe('quick');
    });

    it('should return quick for $99.99 (9999 cents)', () => {
      const preset = getPresetForAmount(9999);
      expect(preset.name).toBe('quick');
    });

    it('should return standard at $100 boundary (10000 cents)', () => {
      const preset = getPresetForAmount(10_000);
      expect(preset.name).toBe('standard');
    });

    it('should return standard for $250 (25000 cents)', () => {
      const preset = getPresetForAmount(25_000);
      expect(preset.name).toBe('standard');
    });

    it('should return premium at $500 boundary (50000 cents)', () => {
      const preset = getPresetForAmount(50_000);
      expect(preset.name).toBe('premium');
    });

    it('should return premium for $2000 (200000 cents)', () => {
      const preset = getPresetForAmount(200_000);
      expect(preset.name).toBe('premium');
    });

    it('should return enterprise at $5000 boundary (500000 cents)', () => {
      const preset = getPresetForAmount(500_000);
      expect(preset.name).toBe('enterprise');
    });

    it('should return enterprise for $100,000', () => {
      const preset = getPresetForAmount(10_000_000);
      expect(preset.name).toBe('enterprise');
    });

    it('quick preset skips DISCOVERY and CLOSING phases', () => {
      const quick = getPresetForAmount(5000);
      expect(quick.phases).not.toContain('DISCOVERY');
      expect(quick.phases).not.toContain('CLOSING');
      expect(quick.phases).toContain('BARGAINING');
    });

    it('standard preset includes all 5 phases', () => {
      const std = getPresetForAmount(30_000);
      expect(std.phases).toHaveLength(5);
    });

    it('premium enables reasoning', () => {
      const premium = getPresetForAmount(80_000);
      expect(premium.reasoning_enabled).toBe(true);
      expect(premium.respond_mode).toBe('llm');
    });

    it('quick disables reasoning', () => {
      const quick = getPresetForAmount(5000);
      expect(quick.reasoning_enabled).toBe(false);
      expect(quick.respond_mode).toBe('template');
    });
  });

  describe('getPresetByName', () => {
    it('should find quick by name', () => {
      expect(getPresetByName('quick')?.name).toBe('quick');
    });

    it('should find enterprise by name', () => {
      expect(getPresetByName('enterprise')?.max_rounds).toBe(20);
    });

    it('should return undefined for unknown name', () => {
      expect(getPresetByName('nonexistent')).toBeUndefined();
    });
  });

  describe('preset consistency', () => {
    it('should have contiguous, non-overlapping amount ranges', () => {
      for (let i = 1; i < PIPELINE_PRESETS.length; i++) {
        expect(PIPELINE_PRESETS[i]!.min_amount).toBe(PIPELINE_PRESETS[i - 1]!.max_amount);
      }
    });

    it('should start at 0 and end at Infinity', () => {
      expect(PIPELINE_PRESETS[0]!.min_amount).toBe(0);
      expect(PIPELINE_PRESETS[PIPELINE_PRESETS.length - 1]!.max_amount).toBe(Infinity);
    });

    it('should have increasing max_rounds', () => {
      for (let i = 1; i < PIPELINE_PRESETS.length; i++) {
        expect(PIPELINE_PRESETS[i]!.max_rounds).toBeGreaterThanOrEqual(
          PIPELINE_PRESETS[i - 1]!.max_rounds,
        );
      }
    });
  });
});
