/**
 * Deterministic conversion: EngineStats → flat MasterStrategy-compatible params.
 *
 * Pure function, no external dependencies. Same stats always produce the same
 * parameters. Formulas come from docs/engine/06_에이전트_스탯.md §3-6.
 *
 * Output shape matches engine-session MasterStrategy fields so the result
 * can be used directly as a session negotiationAgentSnapshot.
 */

import type { EngineParameters, EngineStats } from "./types.js";
import { STAT_BUDGET, STAT_KEYS, STAT_MAX, STAT_MIN } from "./types.js";

function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export interface StatsValidation {
  valid: boolean;
  error?: string;
  total?: number;
}

/** Verify stats are in [STAT_MIN, STAT_MAX] and total === STAT_BUDGET. */
export function validateStats(stats: EngineStats): StatsValidation {
  for (const key of STAT_KEYS) {
    const v = stats[key];
    if (typeof v !== "number" || Number.isNaN(v)) {
      return { valid: false, error: `Stat '${key}' is not a number` };
    }
    if (v < STAT_MIN || v > STAT_MAX) {
      return {
        valid: false,
        error: `Stat '${key}' = ${v} out of range [${STAT_MIN}, ${STAT_MAX}]`,
      };
    }
  }
  const total = STAT_KEYS.reduce((sum, k) => sum + stats[k], 0);
  if (total !== STAT_BUDGET) {
    return {
      valid: false,
      error: `Stats total ${total} ≠ ${STAT_BUDGET}`,
      total,
    };
  }
  return { valid: true, total };
}

/**
 * Convert 8 stats to engine parameters.
 *
 * Throws if stats are invalid (use {@link validateStats} to check first).
 */
export function statsToParameters(stats: EngineStats): EngineParameters {
  const v = validateStats(stats);
  if (!v.valid) {
    throw new Error(`Invalid stats: ${v.error}`);
  }

  const {
    anchoring: a,
    tenacity: te,
    resolve: re,
    market_sense: ms,
    risk_radar: rr,
    scrutiny: sc,
    patience: pa,
    rapport: ra,
  } = stats;

  // Group: Battle (Stance)
  const anchor_ratio = 1.0 - (a / 100) * 0.4;
  const beta = 0.3 + (te / 100) * 2.9;
  const u_threshold = 0.25 + (re / 100) * 0.55;
  const u_aspiration = u_threshold + 0.15;

  // Group: Intelligence
  const gamma = (ms / 100) * 0.2;
  const market_utilization = ms / 100;
  const cross_pressure_sensitivity = ms / 100;
  const w_rep = 0.3 + (rr / 100) * 0.5;
  const w_info = 1.0 - w_rep;
  const r_score_minimum = (rr / 100) * 0.6;
  const i_completeness_minimum = (sc / 100) * 0.7;

  // Group: Context (Time / Relationship)
  const alpha = 0.3 + (pa / 100) * 2.7;
  const v_t_floor = (pa / 100) * 0.85;
  const v_s_base = 0.3 + (ra / 100) * 0.5;
  const n_threshold = Math.max(1, Math.round(15 - (ra / 100) * 10));
  const late_round_aggression_modifier = ra > 60 ? 0.8 : 1.0;

  // Weights — auto-derived (docs §6).
  const raw_wp = a * 0.4 + te * 0.3 + re * 0.2 + ms * 0.1;
  const raw_wt = (100 - pa) * 0.8 + te * 0.2;
  const raw_wr = rr * 0.5 + sc * 0.5;
  const raw_ws = ra * 0.9 + pa * 0.1;
  const total = raw_wp + raw_wt + raw_wr + raw_ws;

  return {
    weights: {
      w_p: r4(raw_wp / total),
      w_t: r4(raw_wt / total),
      w_r: r4(raw_wr / total),
      w_s: r4(raw_ws / total),
    },
    anchor_ratio: r4(anchor_ratio),
    alpha: r4(alpha),
    beta: r4(beta),
    v_t_floor: r4(v_t_floor),
    u_threshold: r4(u_threshold),
    u_aspiration: r4(u_aspiration),
    gamma: r4(gamma),
    market_utilization: r4(market_utilization),
    cross_pressure_sensitivity: r4(cross_pressure_sensitivity),
    w_rep: r4(w_rep),
    w_info: r4(w_info),
    r_score_minimum: r4(r_score_minimum),
    i_completeness_minimum: r4(i_completeness_minimum),
    v_s_base: r4(v_s_base),
    n_threshold,
    late_round_aggression_modifier,
  };
}
