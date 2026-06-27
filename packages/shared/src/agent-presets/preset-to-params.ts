/**
 * NegotiationAgentPreset → EngineParameters.
 *
 * Option C (2026-05-12): presets declare 16 of 17 EngineParameters fields.
 * w_info is derived as 1 - w_rep. Only the 3 market-awareness fields stay
 * as cross-preset neutrals (LLM tuning will set them per-user later).
 */

import type { EngineParameters } from "../agent-stats/types.js";
import type { NegotiationAgentPreset } from "./types.js";

/** Market-awareness defaults shared by every preset. LLM tuning may override per agent. */
const MARKET_NEUTRAL_DEFAULTS = {
  gamma: 0.1,
  market_utilization: 0.5,
  cross_pressure_sensitivity: 0.5,
} as const;

/** Convert a NegotiationAgentPreset to a complete EngineParameters object. */
export function presetToEngineParameters(preset: NegotiationAgentPreset): EngineParameters {
  return {
    weights: { ...preset.weights },
    alpha: preset.alpha,
    beta: preset.beta,
    u_threshold: preset.u_threshold,
    u_aspiration: preset.u_aspiration,
    anchor_ratio: preset.anchor_ratio,
    v_t_floor: preset.v_t_floor,
    w_rep: preset.w_rep,
    w_info: 1 - preset.w_rep,
    r_score_minimum: preset.r_score_minimum,
    i_completeness_minimum: preset.i_completeness_minimum,
    v_s_base: preset.v_s_base,
    n_threshold: preset.n_threshold,
    late_round_aggression_modifier: preset.late_round_aggression_modifier,
    ...MARKET_NEUTRAL_DEFAULTS,
  };
}
