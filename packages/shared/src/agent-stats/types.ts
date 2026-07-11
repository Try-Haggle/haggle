/**
 * Agent core types — the single resolved personality form (`EngineParameters`)
 * and the saved-agent shape (`NegotiationAgent`).
 *
 * History: the legacy 8-stat (`anchoring…`) and 5-stat editors were removed
 * (2026-06). Presets + advanced sliders + builder chat now all resolve to the
 * one `EngineParameters` form (4D weights + behavior curves).
 */

import type { NegotiationAgentPresetId, NegotiationWeights } from "../agent-presets/types.js";

export type AgentRole = "buyer" | "seller" | "both";

/**
 * User-saved or preset-derived agent. The strategy is expressed as a starting
 * preset plus optional weight/knob overrides — all of which resolve to a single
 * `EngineParameters` object (see `presetToEngineParameters` / `resolveEffectivePreset`).
 */
export interface NegotiationAgent {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  role?: AgentRole;

  /** Preset this agent was forked from (e.g. "balancer"). */
  basePresetId?: string;
  /** Negotiation preset id ("hunter" / "closer" / "balancer") used as starting point. */
  negotiationAgentPresetId?: NegotiationAgentPresetId;
  /** 4D weight override. Takes precedence over the preset's weights when present. */
  weights?: NegotiationWeights;
  /** Per-knob overrides for the rest of EngineParameters. Weights live in `weights`. */
  engineParams?: Partial<Omit<EngineParameters, "weights">>;
  /** Per-category form answers, keyed by category id (e.g. "iphone", "vehicle"). */
  categoryAnswers?: Record<string, Record<string, unknown>>;
  /** Voice profile id — wiring is reserved for next sprint. */
  voiceId?: string;
  /**
   * Durable builder-chat memory captured when this agent was built
   * (must-haves, deal-breakers, urgency, negotiation style). Carried so a saved
   * agent's negotiation posture reaches the negotiation when the agent is
   * reused, not just when the user re-runs the builder chat.
   */
  builderChatMemory?: Record<string, unknown>;

  createdAt: number;
  updatedAt: number;
}

/**
 * The single canonical personality form: 4D weights + behavior curves.
 * Presets declare 16 of these 17 fields directly; `w_info` is derived as
 * `1 - w_rep`. Flat, MasterStrategy-compatible.
 */
export interface EngineParameters {
  weights: { w_p: number; w_t: number; w_r: number; w_s: number };
  anchor_ratio: number;
  alpha: number;
  beta: number;
  v_t_floor: number;
  u_threshold: number;
  u_aspiration: number;
  gamma: number;
  market_utilization: number;
  cross_pressure_sensitivity: number;
  w_rep: number;
  w_info: number;
  r_score_minimum: number;
  i_completeness_minimum: number;
  v_s_base: number;
  n_threshold: number;
  late_round_aggression_modifier: number;
}
