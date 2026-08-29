/**
 * harness-box.ts — bridge from the coach's output to this round's harness box.
 *
 * Composes what already exists (RefereeCoaching.recommended_price = baseline,
 * .acceptable_range = full feasible range) with the harness primitives
 * (applyAutonomy) and, when available, the opponent estimate (adjustAim).
 *
 * Returns null when the coach range isn't usable (e.g. the facts-only briefing
 * path, which leaves acceptable_range at {0,0}) so callers cleanly no-op.
 */

import type { OpponentEstimate, RefereeCoaching } from "../types.js";
import { applyAutonomy, type Box, clampToBox, type FeasibleRange } from "./harness.js";
import { adjustAim } from "./opponent-adjust.js";

/**
 * Box-width dial [0,1]: how much of the coach's safe range the AI may roam,
 * centered on the baseline. 0 = pure engine (box collapses to baseline),
 * 1 = full acceptable_range.
 *
 * The live dial is the full coach range (1.0). A narrow box around Faratin
 * `recommended_price` made every SKU close at the same number even when SOFT
 * facts (storage, battery) differed. Safety stays on the price envelope
 * (floor / published ask / no backwards), not on a scripted aim. See
 * decide-prompt-contract.md.
 */
export const DEFAULT_AUTONOMY = 1;

export interface HarnessBox {
  box: Box;
  /** The full feasible range (coach.acceptable_range) the box was derived from. */
  range: { min: number; max: number };
  /** Deterministic engine recommendation (quality floor). */
  baseline: number;
  /** Opponent-adjusted aim inside the box (= baseline when no estimate). */
  aim: number;
}

/**
 * Build the round's box + baseline + aim from coach output. `null` if coaching is
 * missing or the range is degenerate (not a real box) so the caller cleanly
 * no-ops instead of throwing.
 */
export function computeHarnessBox(
  coaching: RefereeCoaching | undefined,
  boundaries: { my_target: number; my_floor: number },
  autonomy: number,
  opponentEstimate?: OpponentEstimate,
): HarnessBox | null {
  const range0 = coaching?.acceptable_range;
  if (!range0) return null;
  const baseline = coaching.recommended_price;
  const { min, max } = range0;
  // Guard: reject the facts-only / degenerate range so we never clamp to [0,0].
  if (!Number.isFinite(baseline) || baseline <= 0) return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;

  const range: FeasibleRange = { baseline, min, max };
  const box = applyAutonomy(range, autonomy);
  const aim = opponentEstimate
    ? adjustAim(baseline, boundaries.my_target, box, opponentEstimate).aim
    : clampToBox(baseline, box).value;

  return { box, range: { min, max }, baseline, aim };
}
