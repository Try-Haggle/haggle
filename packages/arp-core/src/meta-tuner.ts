import type { ArpConfig, ArpCycleHistory, MetaTunerResult } from "./types.js";
import { DEFAULT_ARP_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// Meta-Tuner bounds
// ---------------------------------------------------------------------------

const MIN_CYCLE_DAYS = 7;
const MAX_CYCLE_DAYS = 60;
const MIN_STEP_HOURS = 3;
const MAX_STEP_HOURS = 12;
const MIN_MAX_STEPS = 1;
const MAX_MAX_STEPS = 4;

// ---------------------------------------------------------------------------
// tuneConfig — Layer 3 meta-tuner
// ---------------------------------------------------------------------------

export function tuneConfig(
  history: ArpCycleHistory[],
  current_config: ArpConfig = DEFAULT_ARP_CONFIG,
): MetaTunerResult {
  const result: MetaTunerResult = {
    cycle_days: current_config.cycle_days,
    max_steps_per_cycle: current_config.max_steps_per_cycle,
    step_hours: current_config.step_hours,
    adjustments: [],
  };

  if (history.length < 2) {
    result.adjustments.push("insufficient_history");
    return result;
  }

  // Sort by cycle_index ascending
  const sorted = [...history].sort((a, b) => a.cycle_index - b.cycle_index);

  const oscillating = detectOscillation(sorted);
  const longHold = detectLongHold(sorted);
  const trending = detectTrend(sorted);

  // Oscillation: INCREASE↔DECREASE alternating → stabilize
  if (oscillating) {
    // Reduce step size to dampen oscillation
    result.step_hours = Math.max(MIN_STEP_HOURS, current_config.step_hours - 1);
    // Increase cycle length to allow more data collection
    result.cycle_days = Math.min(MAX_CYCLE_DAYS, current_config.cycle_days + 7);
    result.adjustments.push("oscillation_detected: step_reduced, cycle_extended");
  }

  // Long HOLD (5+ consecutive): expand cycle, system is stable
  if (longHold) {
    result.cycle_days = Math.min(MAX_CYCLE_DAYS, current_config.cycle_days + 14);
    result.adjustments.push("long_hold_detected: cycle_extended");
  }

  // Strong trend (2+ same direction): shorten cycle, increase responsiveness
  if (trending) {
    result.cycle_days = Math.max(MIN_CYCLE_DAYS, current_config.cycle_days - 3);
    result.max_steps_per_cycle = Math.min(MAX_MAX_STEPS, current_config.max_steps_per_cycle + 1);
    result.adjustments.push("trend_detected: cycle_shortened, max_steps_increased");
  }

  // Clamp all values
  result.cycle_days = clamp(result.cycle_days, MIN_CYCLE_DAYS, MAX_CYCLE_DAYS);
  result.step_hours = clamp(result.step_hours, MIN_STEP_HOURS, MAX_STEP_HOURS);
  result.max_steps_per_cycle = clamp(result.max_steps_per_cycle, MIN_MAX_STEPS, MAX_MAX_STEPS);

  if (result.adjustments.length === 0) {
    result.adjustments.push("no_adjustment_needed");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pattern detectors
// ---------------------------------------------------------------------------

/**
 * Oscillation: at least 3 most-recent non-HOLD entries alternate direction.
 */
function detectOscillation(sorted: ArpCycleHistory[]): boolean {
  const nonHold = sorted.filter(h => h.direction !== "HOLD");
  if (nonHold.length < 3) return false;

  const recent = nonHold.slice(-3);
  return (
    recent[0].direction !== recent[1].direction &&
    recent[1].direction !== recent[2].direction
  );
}

/**
 * Long HOLD: last 5+ entries are all HOLD.
 */
function detectLongHold(sorted: ArpCycleHistory[]): boolean {
  if (sorted.length < 5) return false;
  const last5 = sorted.slice(-5);
  return last5.every(h => h.direction === "HOLD");
}

/**
 * Trend: last 2+ non-HOLD entries share the same direction with magnitude > 0.
 */
function detectTrend(sorted: ArpCycleHistory[]): boolean {
  const nonHold = sorted.filter(h => h.direction !== "HOLD");
  if (nonHold.length < 2) return false;

  const last2 = nonHold.slice(-2);
  return last2[0].direction === last2[1].direction;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
