import type { AdjustmentResult, ArpConfig, SegmentData, SignalResult } from "./types.js";
import { DEFAULT_ARP_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// computeAdjustment — Layer 2 ARP adjustment logic
// ---------------------------------------------------------------------------

export function computeAdjustment(
  segment: SegmentData,
  signals: SignalResult,
  config: ArpConfig = DEFAULT_ARP_CONFIG,
): AdjustmentResult {
  const base: Omit<AdjustmentResult, "new_hours" | "step_count" | "direction" | "skipped" | "skip_reason"> = {
    segment_key: segment.key,
    previous_hours: segment.review_hours,
    signals,
  };

  // Skip if insufficient sample size
  if (segment.sample_count < config.min_sample_count) {
    return {
      ...base,
      new_hours: segment.review_hours,
      step_count: 0,
      direction: "HOLD",
      skipped: true,
      skip_reason: `sample_count ${segment.sample_count} < min ${config.min_sample_count}`,
    };
  }

  // No change needed
  if (signals.direction === "HOLD") {
    return {
      ...base,
      new_hours: segment.review_hours,
      step_count: 0,
      direction: "HOLD",
      skipped: false,
    };
  }

  // Calculate steps: magnitude_per_step units of magnitude = 1 step
  const rawSteps = Math.abs(signals.net_magnitude) / config.magnitude_per_step;
  const steps = Math.min(Math.floor(rawSteps), config.max_steps_per_cycle);

  if (steps === 0) {
    return {
      ...base,
      new_hours: segment.review_hours,
      step_count: 0,
      direction: "HOLD",
      skipped: false,
    };
  }

  const delta = steps * config.step_hours * (signals.direction === "INCREASE" ? 1 : -1);
  const raw = segment.review_hours + delta;

  // Hard bounds clamp
  const clamped = Math.max(config.min_hours, Math.min(config.max_hours, raw));

  return {
    ...base,
    new_hours: clamped,
    step_count: steps,
    direction: signals.direction,
    skipped: false,
  };
}
