import type { ColdStartStage } from "./types.js";
import { COLD_START_THRESHOLDS } from "./types.js";

/**
 * Classify user's cold start stage based on completed trade count.
 *
 * NEW (0-4): No score displayed. "NEW" badge.
 * SCORING (5-19): Score computed but flagged as preliminary.
 * MATURE (20+): Fully reliable score.
 */
export function classifyColdStart(trade_count: number): ColdStartStage {
  if (trade_count < COLD_START_THRESHOLDS.scoring_min) {
    return "NEW";
  }
  if (trade_count < COLD_START_THRESHOLDS.mature_min) {
    return "SCORING";
  }
  return "MATURE";
}
