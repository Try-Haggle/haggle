/**
 * referee/violation-tracker.ts
 *
 * HARD violation hit-rate tracking for Lite mode transition decisions.
 * Step 67-A — provides data for deciding when full→lite switch is safe.
 */

import type { ValidationResult } from '../types.js';
import type { ValidationMode } from '../config.js';

export interface ViolationStats {
  total_rounds: number;
  hard_violations: number;
  hard_hit_rate: number; // hard_violations / total_rounds
  last_hard_violation?: {
    round: number;
    rule: string;
    timestamp: number;
  };
  recommended_mode: ValidationMode; // rate < 0.01 → 'lite', else 'full'
}

/** Threshold: HARD hit rate below 1% recommends 'lite' mode */
const LITE_THRESHOLD = 0.01;

/** Minimum sample size before recommending lite */
const MIN_SAMPLE_SIZE = 100;

export class ViolationTracker {
  private _totalRounds = 0;
  private _hardViolations = 0;
  private _lastHard: ViolationStats['last_hard_violation'] | undefined;

  /** Record a round's validation result */
  record(validation: ValidationResult, round?: number): void {
    this._totalRounds++;
    const hardVios = validation.violations.filter((v) => v.severity === 'HARD');
    if (hardVios.length > 0) {
      this._hardViolations++;
      this._lastHard = {
        round: round ?? this._totalRounds,
        rule: hardVios[0]!.rule,
        timestamp: Date.now(),
      };
    }
  }

  /** Current statistics */
  getStats(): ViolationStats {
    const rate = this._totalRounds > 0 ? this._hardViolations / this._totalRounds : 0;
    return {
      total_rounds: this._totalRounds,
      hard_violations: this._hardViolations,
      hard_hit_rate: rate,
      last_hard_violation: this._lastHard,
      recommended_mode: this.getRecommendedMode(),
    };
  }

  /** Recommended mode: lite only if enough samples and rate < 1% */
  getRecommendedMode(): ValidationMode {
    if (this._totalRounds < MIN_SAMPLE_SIZE) return 'full';
    const rate = this._hardViolations / this._totalRounds;
    return rate < LITE_THRESHOLD ? 'lite' : 'full';
  }

  /** Reset all counters (test utility) */
  reset(): void {
    this._totalRounds = 0;
    this._hardViolations = 0;
    this._lastHard = undefined;
  }
}
