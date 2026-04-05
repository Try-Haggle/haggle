import type { ArpConfig, SignalDetail, SignalMetrics, SignalResult } from "./types.js";
import { DEFAULT_ARP_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// Signal magnitudes (from design doc)
// ---------------------------------------------------------------------------

const SIGNAL_MAGNITUDES = {
  late_dispute:       +2,    // period too short
  late_valid_dispute: +3,    // strong signal — period too short
  discovery_p90:      -1,    // over-protection
  auto_confirm:       -0.5,  // possible over-protection
  buyer_valid:        +1,    // need more protection
} as const;

// ---------------------------------------------------------------------------
// computeSignals
// ---------------------------------------------------------------------------

export function computeSignals(
  metrics: SignalMetrics,
  current_review_hours: number,
  config: ArpConfig = DEFAULT_ARP_CONFIG,
): SignalResult {
  const { thresholds } = config;
  const total = metrics.total_actions;

  const signals: SignalDetail[] = [];

  // Signal 1: late_dispute_rate > 15%
  const lateDisputeRate = total > 0 ? metrics.late_disputes / total : 0;
  signals.push({
    name: "late_dispute_rate",
    triggered: lateDisputeRate > thresholds.late_dispute_rate,
    value: lateDisputeRate,
    threshold: thresholds.late_dispute_rate,
    magnitude: lateDisputeRate > thresholds.late_dispute_rate ? SIGNAL_MAGNITUDES.late_dispute : 0,
  });

  // Signal 2: late_valid_dispute_rate > 10%
  const lateValidRate = total > 0 ? metrics.late_valid_disputes / total : 0;
  signals.push({
    name: "late_valid_dispute_rate",
    triggered: lateValidRate > thresholds.late_valid_dispute_rate,
    value: lateValidRate,
    threshold: thresholds.late_valid_dispute_rate,
    magnitude: lateValidRate > thresholds.late_valid_dispute_rate ? SIGNAL_MAGNITUDES.late_valid_dispute : 0,
  });

  // Signal 3: discovery_p90 < 70% of review period → over-protection
  const p90Ratio = current_review_hours > 0 ? metrics.discovery_p90_hours / current_review_hours : 1;
  signals.push({
    name: "discovery_p90_ratio",
    triggered: p90Ratio < thresholds.discovery_p90_ratio,
    value: p90Ratio,
    threshold: thresholds.discovery_p90_ratio,
    magnitude: p90Ratio < thresholds.discovery_p90_ratio ? SIGNAL_MAGNITUDES.discovery_p90 : 0,
  });

  // Signal 4: auto_confirm_rate > 95% → over-protection
  const autoConfirmRate = total > 0 ? metrics.auto_confirms / total : 0;
  signals.push({
    name: "auto_confirm_rate",
    triggered: autoConfirmRate > thresholds.auto_confirm_rate,
    value: autoConfirmRate,
    threshold: thresholds.auto_confirm_rate,
    magnitude: autoConfirmRate > thresholds.auto_confirm_rate ? SIGNAL_MAGNITUDES.auto_confirm : 0,
  });

  // Signal 5: buyer_valid_rate > 3% → need more protection
  const buyerValidRate = total > 0 ? metrics.buyer_valid_disputes / total : 0;
  signals.push({
    name: "buyer_valid_rate",
    triggered: buyerValidRate > thresholds.buyer_valid_rate,
    value: buyerValidRate,
    threshold: thresholds.buyer_valid_rate,
    magnitude: buyerValidRate > thresholds.buyer_valid_rate ? SIGNAL_MAGNITUDES.buyer_valid : 0,
  });

  const net_magnitude = signals.reduce((sum, s) => sum + s.magnitude, 0);
  const direction =
    net_magnitude > 0 ? "INCREASE" as const :
    net_magnitude < 0 ? "DECREASE" as const :
    "HOLD" as const;

  return { signals, net_magnitude, direction };
}
