/**
 * harness.ts — the "engine sets the box, AI plays in the box" core (SOT §11 하네스).
 *
 * Pure functions, no I/O. Three jobs:
 *   1. applyAutonomy — narrow the coach's feasible range into the round's box by
 *      the autonomy dial (0 = pure engine, 1 = full range).
 *   2. clampToBox   — the Referee rail: pull an AI value back inside the box.
 *   3. buildHarnessTrace — assemble the intelligence-layer log for the round.
 *
 * Wired into the pipeline (backlog #13/#14):
 *   - referee/harness-box.ts → computeHarnessBox(coach output → box, autonomy 0.2)
 *   - adapters/deepseek-adapter.ts → renders the box into the LLM prompt (BOX line)
 *   - stages/decide.ts   → clamps the AI price to the box + builds the trace
 *   - stages/validate.ts → passes the trace into RoundExplainability.harness
 *   - executor.ts        → already persists explainability into metadata (auto-logged)
 * Still pending: validate-side HARD box enforcement/REJECT policy (#10), and the
 * opponent estimate is produced by the decide LLM (folded in), not a separate sensor.
 */

import type { HarnessTrace, OpponentEstimate } from "../types.js";

/** The engine's full feasible range for this round (coach.acceptable_range) + baseline. */
export interface FeasibleRange {
  /** Deterministic engine recommendation — the quality floor. */
  baseline: number;
  /** Coach's full acceptable range [min,max]; baseline should sit inside. */
  min: number;
  max: number;
}

export interface Box {
  min: number;
  max: number;
  width: number;
}

/**
 * Narrow the full feasible range into this round's box using the autonomy dial.
 *
 * The box is centered on the baseline and widened toward each edge by `autonomy`:
 *   box_min = baseline − autonomy·(baseline − min)
 *   box_max = baseline + autonomy·(max − baseline)
 *
 * autonomy = 0 → box collapses to [baseline, baseline] (pure engine, deterministic).
 * autonomy = 1 → box = [min, max] (AI free within the full safe range).
 *
 * MVP starts narrow (~0.2) and widens as the intelligence log shows AI beating
 * the baseline without excessive clamps.
 */
export function applyAutonomy(range: FeasibleRange, autonomy: number): Box {
  const a = clamp01(autonomy);
  // Guard against a malformed range (baseline outside [min,max]).
  const lo = Math.min(range.min, range.max);
  const hi = Math.max(range.min, range.max);
  const base = clampTo(range.baseline, lo, hi);
  const min = base - a * (base - lo);
  const max = base + a * (hi - base);
  return { min, max, width: Math.max(0, max - min) };
}

/** The Referee rail: pull an AI price back inside the box. */
export function clampToBox(
  price: number,
  box: Box,
): { value: number; clamped: boolean; reason?: string } {
  if (price < box.min) return { value: box.min, clamped: true, reason: "below_box" };
  if (price > box.max) return { value: box.max, clamped: true, reason: "above_box" };
  return { value: price, clamped: false };
}

/**
 * Signed delta of the final value vs the baseline, normalized by box width.
 * > 0 = AI moved past the deterministic baseline (upside); 0 = matched baseline
 * (or box collapsed). Undefined price → 0 (non-price action).
 */
export function deltaVsBaseline(
  finalPrice: number | undefined,
  baseline: number,
  box: Box,
): number {
  if (finalPrice === undefined || box.width <= 0) return 0;
  return (finalPrice - baseline) / box.width;
}

export interface HarnessTraceInput {
  range: FeasibleRange;
  autonomy: number;
  ai: { price?: number; tactic?: string; source: "llm" | "skill" };
  /** Opponent-adjusted aim within the box (from opponent-adjust.ts), if used. */
  aim?: number;
  /** Opponent estimate that produced the aim, for later "was the read right?" analysis. */
  opponent_estimate?: OpponentEstimate;
  model_id?: string;
  skill_ids?: string[];
}

/**
 * Assemble one round's harness trace (intelligence layer). Computes the box from
 * autonomy, clamps the AI value, and records baseline/delta/clamp/model so the
 * round is fully explainable and learnable. The clamped value is the one that
 * actually goes out; the pre-clamp value is kept in `box_clamp.original`.
 */
export function buildHarnessTrace(input: HarnessTraceInput): HarnessTrace {
  const box = applyAutonomy(input.range, input.autonomy);
  const proposed = input.ai.price;
  const clamp =
    proposed === undefined ? { value: undefined, clamped: false } : clampToBox(proposed, box);
  const finalPrice = clamp.value;

  return {
    box: { min: box.min, max: box.max, width: box.width },
    baseline: input.range.baseline,
    ...(input.aim !== undefined ? { aim: input.aim } : {}),
    ...(input.opponent_estimate ? { opponent_estimate: input.opponent_estimate } : {}),
    ai_choice: { price: finalPrice, tactic: input.ai.tactic, source: input.ai.source },
    delta_vs_baseline: deltaVsBaseline(finalPrice, input.range.baseline, box),
    box_clamp: {
      clamped: clamp.clamped,
      ...(clamp.clamped
        ? { original: proposed, reason: (clamp as { reason?: string }).reason }
        : {}),
    },
    autonomy: clamp01(input.autonomy),
    ...(input.model_id ? { model_id: input.model_id } : {}),
    ...(input.skill_ids && input.skill_ids.length > 0 ? { skill_ids: input.skill_ids } : {}),
  };
}

function clamp01(v: number): number {
  return clampTo(v, 0, 1);
}

function clampTo(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}
