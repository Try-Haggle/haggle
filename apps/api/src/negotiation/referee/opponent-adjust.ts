/**
 * opponent-adjust.ts — Lever A of opponent modeling (SOT §11 하네스, backlog #4).
 *
 * The engine computes MY baseline first (my Faratin curve — my strategy). This
 * module then shifts the AIM POINT within the safe box toward my target when the
 * opponent looks weak (time-pressured), leaving it at the baseline when they look
 * strong — gated by the estimate's confidence, capped by their estimated
 * reservation, and finally clamped to the box.
 *
 * SAFETY INVARIANT: this only moves the aim INSIDE the box. The box edges (my
 * floor) come solely from MY params, so a wrong opponent read is at worst
 * suboptimal, never unsafe.
 *
 * Pure function, no I/O. SCAFFOLD: not wired into coach.ts yet.
 *   Lever A  = adjustAim (this file, per-round aim)   ← now
 *   Lever A+ = reservation cap (built in here)         ← now
 *   Lever B  = dynamic β over rounds (engine-core, backlog #5) ← later
 */

import type { OpponentEstimate } from "../types.js";
import { type Box, clampToBox } from "./harness.js";

export interface AimResult {
  /** Final aim point, clamped to the box. */
  aim: number;
  /** confidence × time_pressure — how far (0..1) we moved baseline→target. */
  shift: number;
  /** True if the estimated reservation price pulled the aim back. */
  reservation_capped: boolean;
  /** True if the box clamped the aim (aim wanted to exit the safe range). */
  box_clamped: boolean;
}

/**
 * Shift the baseline toward my target using the opponent estimate.
 *
 *   shift = confidence × time_pressure          // weak/desperate opponent → push
 *   aim   = baseline + shift × (myTarget − baseline)
 *   aim   = cap by estimated reservation (don't ask past their walk-away)
 *   aim   = clamp to box                         // SAFETY
 *
 * `myTarget` sets the push direction: seller pushes up (target > baseline),
 * buyer pushes down (target < baseline). shift = 0 → aim stays at baseline
 * (pure my-strategy, e.g. strong opponent or zero confidence).
 */
export function adjustAim(
  baseline: number,
  myTarget: number,
  box: Box,
  est: OpponentEstimate,
): AimResult {
  const shift = clamp01(est.confidence) * clamp01(est.time_pressure);
  let aim = baseline + shift * (myTarget - baseline);

  // A+ reservation cap: never aim past the opponent's estimated walk-away.
  let reservation_capped = false;
  const r = est.est_reservation_price;
  if (typeof r === "number" && Number.isFinite(r)) {
    const pushingUp = myTarget >= baseline;
    const capped = pushingUp ? Math.min(aim, r) : Math.max(aim, r);
    if (capped !== aim) {
      aim = capped;
      reservation_capped = true;
    }
  }

  // Safety: the aim must live inside the box regardless of the estimate.
  const clamped = clampToBox(aim, box);
  return { aim: clamped.value, shift, reservation_capped, box_clamped: clamped.clamped };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
