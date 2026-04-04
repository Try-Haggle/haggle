import type { SlaValidationResult } from "./types.js";
import { getMinimumSlaDays } from "./sla-defaults.js";

const MAX_SLA_DAYS = 14;

/**
 * Validate a proposed SLA and return the effective (clamped) value.
 *
 * Rules:
 * - Must be a positive integer (non-integers are floored)
 * - Must be >= category minimum
 * - Must be <= 14 days
 */
export function validateSla(
  proposed_days: number,
  category: string,
): SlaValidationResult {
  const floored = Math.floor(proposed_days);
  const minimum = getMinimumSlaDays(category);

  if (floored <= 0) {
    return {
      valid: false,
      proposed_days,
      effective_days: minimum,
      reason: `SLA days must be positive. Minimum for ${category} is ${minimum}.`,
    };
  }

  if (floored < minimum) {
    return {
      valid: false,
      proposed_days,
      effective_days: minimum,
      reason: `SLA days ${floored} is below the minimum of ${minimum} for category ${category}.`,
    };
  }

  if (floored > MAX_SLA_DAYS) {
    return {
      valid: false,
      proposed_days,
      effective_days: MAX_SLA_DAYS,
      reason: `SLA days ${floored} exceeds the maximum of ${MAX_SLA_DAYS}.`,
    };
  }

  return {
    valid: true,
    proposed_days,
    effective_days: floored,
  };
}
