import { describe, it, expect, beforeEach } from 'vitest';
import { ViolationTracker } from '../violation-tracker.js';
import type { ValidationResult } from '../../types.js';

describe('ViolationTracker', () => {
  let tracker: ViolationTracker;

  beforeEach(() => {
    tracker = new ViolationTracker();
  });

  const CLEAN: ValidationResult = { passed: true, hardPassed: true, violations: [] };

  const SOFT_ONLY: ValidationResult = {
    passed: false,
    hardPassed: true,
    violations: [{ rule: 'V5', severity: 'SOFT', guidance: 'stagnation' }],
  };

  const HARD_HIT: ValidationResult = {
    passed: false,
    hardPassed: false,
    violations: [{ rule: 'V1', severity: 'HARD', guidance: 'floor exceeded' }],
  };

  it('should start with zero stats', () => {
    const stats = tracker.getStats();
    expect(stats.total_rounds).toBe(0);
    expect(stats.hard_violations).toBe(0);
    expect(stats.hard_hit_rate).toBe(0);
    expect(stats.last_hard_violation).toBeUndefined();
  });

  it('should track clean rounds', () => {
    tracker.record(CLEAN);
    tracker.record(CLEAN);
    const stats = tracker.getStats();
    expect(stats.total_rounds).toBe(2);
    expect(stats.hard_violations).toBe(0);
    expect(stats.hard_hit_rate).toBe(0);
  });

  it('should not count SOFT violations as HARD', () => {
    tracker.record(SOFT_ONLY);
    const stats = tracker.getStats();
    expect(stats.hard_violations).toBe(0);
  });

  it('should track HARD violations and update last_hard_violation', () => {
    tracker.record(CLEAN);
    tracker.record(HARD_HIT, 2);
    const stats = tracker.getStats();
    expect(stats.hard_violations).toBe(1);
    expect(stats.hard_hit_rate).toBe(0.5);
    expect(stats.last_hard_violation).toBeDefined();
    expect(stats.last_hard_violation!.round).toBe(2);
    expect(stats.last_hard_violation!.rule).toBe('V1');
  });

  it('should compute hit rate correctly', () => {
    for (let i = 0; i < 99; i++) tracker.record(CLEAN);
    tracker.record(HARD_HIT, 100);
    const stats = tracker.getStats();
    expect(stats.hard_hit_rate).toBe(1 / 100);
    expect(stats.total_rounds).toBe(100);
  });

  it('should recommend full when below minimum sample size', () => {
    for (let i = 0; i < 50; i++) tracker.record(CLEAN);
    expect(tracker.getRecommendedMode()).toBe('full');
  });

  it('should recommend lite when HARD rate < 1% with sufficient samples', () => {
    // 200 clean rounds, 0 HARD
    for (let i = 0; i < 200; i++) tracker.record(CLEAN);
    expect(tracker.getRecommendedMode()).toBe('lite');
  });

  it('should recommend full when HARD rate >= 1%', () => {
    for (let i = 0; i < 98; i++) tracker.record(CLEAN);
    tracker.record(HARD_HIT);
    tracker.record(HARD_HIT);
    // 2/100 = 2% → full
    expect(tracker.getRecommendedMode()).toBe('full');
  });

  it('should reset all counters', () => {
    tracker.record(HARD_HIT, 1);
    tracker.reset();
    const stats = tracker.getStats();
    expect(stats.total_rounds).toBe(0);
    expect(stats.hard_violations).toBe(0);
    expect(stats.last_hard_violation).toBeUndefined();
  });

  it('should include recommended_mode in stats', () => {
    for (let i = 0; i < 150; i++) tracker.record(CLEAN);
    const stats = tracker.getStats();
    expect(stats.recommended_mode).toBe('lite');
  });
});
