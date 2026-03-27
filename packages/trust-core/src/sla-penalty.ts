import type { SlaPenaltyInput, SlaPenaltyResult } from "./types.js";
import { SLA_PENALTY_BASE } from "./types.js";

// ---------------------------------------------------------------------------
// SLA Penalty computation
// ---------------------------------------------------------------------------

/**
 * Get the frequency multiplier based on how many SLA violations in 90 days.
 *
 * 1st violation:  1.0x
 * 2nd in 90 days: 1.5x
 * 3rd in 90 days: 2.5x
 * 4th+ in 90 days: 4.0x
 */
export function getFrequencyMultiplier(violations_in_90d: number): number {
  if (violations_in_90d <= 1) return 1.0;
  if (violations_in_90d === 2) return 1.5;
  if (violations_in_90d === 3) return 2.5;
  return 4.0;
}

/**
 * Compute Trust Score penalty for SLA violation.
 *
 * Formula: base × (overdue_days / sla_days) × frequency_multiplier
 *
 * - overdue_ratio reflects severity relative to the agreed SLA
 *   (e.g., 2 days late on a 3-day SLA = 0.67, 5 days late = 1.67)
 * - frequency_multiplier escalates for repeat offenders
 * - No cap — extreme violations can result in large penalties
 *
 * Returns 0 if overdue_days <= 0 or sla_days <= 0.
 */
export function computeSlaPenalty(input: SlaPenaltyInput): SlaPenaltyResult {
  if (input.overdue_days <= 0 || input.sla_days <= 0) {
    return {
      penalty: 0,
      base: SLA_PENALTY_BASE,
      overdue_ratio: 0,
      frequency_multiplier: getFrequencyMultiplier(input.violations_in_90d),
    };
  }

  const overdue_ratio = input.overdue_days / input.sla_days;
  const frequency_multiplier = getFrequencyMultiplier(input.violations_in_90d);
  const penalty = SLA_PENALTY_BASE * overdue_ratio * frequency_multiplier;

  return {
    penalty: Math.round(penalty * 100) / 100,
    base: SLA_PENALTY_BASE,
    overdue_ratio: Math.round(overdue_ratio * 100) / 100,
    frequency_multiplier,
  };
}
