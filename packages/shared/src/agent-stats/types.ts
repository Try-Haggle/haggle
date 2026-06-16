/**
 * Agent stats types — see docs/engine/06_에이전트_스탯.md and 22_에이전트_스탯_UI_매핑.md
 */

import type {
  NegotiationAgentPresetId,
  NegotiationWeights,
} from "../agent-presets/types.js";

export type StatKey =
  | "anchoring"
  | "tenacity"
  | "resolve"
  | "market_sense"
  | "risk_radar"
  | "scrutiny"
  | "patience"
  | "rapport";

export const STAT_KEYS: readonly StatKey[] = [
  "anchoring",
  "tenacity",
  "resolve",
  "market_sense",
  "risk_radar",
  "scrutiny",
  "patience",
  "rapport",
] as const;

/** 8 raw stats. Each [10..90], total = 400. */
export type EngineStats = Record<StatKey, number>;

/** Internal grouping (matches docs 06.md §2). UI may relabel "battle" → "Stance". */
export type StatGroup = "battle" | "intelligence" | "context";

export const STAT_GROUP: Record<StatKey, StatGroup> = {
  anchoring: "battle",
  tenacity: "battle",
  resolve: "battle",
  market_sense: "intelligence",
  risk_radar: "intelligence",
  scrutiny: "intelligence",
  patience: "context",
  rapport: "context",
};

/** Budget constraints (docs 06.md §2). */
export const STAT_BUDGET = 400;
export const STAT_MIN = 10;
export const STAT_MAX = 90;

export type AgentRole = "buyer" | "seller" | "both";

/** Voice/role copy variant for one stat. */
export interface StatCopy {
  /** Description when stat is low (≤ 30). */
  lo: string;
  /** Description when stat is high (≥ 70). */
  hi: string;
}

export type RoleCopy = Record<StatKey, StatCopy>;

/** A 6-preset entry. Stats sum to 400. */
export interface AgentPreset {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  description: string;
  accentColor: string;
  stats: EngineStats;
}

/**
 * User-saved or preset-derived agent. Two strategy shapes coexist:
 *
 *  • Legacy 8-stat path (Q5b advanced editor) — `stats` + optional `basePresetId`.
 *  • New 4D-weight path (default flow)        — `negotiationAgentPresetId` and/or
 *                                                `weights` + optional `engineParams`.
 *
 * `resolveAgentToEngineParameters` (in agent-presets) takes either shape and
 * returns a complete EngineParameters object. At least one shape must be
 * populated for the agent to drive a session.
 */
export interface NegotiationAgent {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  role?: AgentRole;

  // ── Legacy 8-stat path ──────────────────────────────────────────────────
  /** 8-stat preset id this agent was forked from (e.g. "fox"). */
  basePresetId?: string;
  /** 8 raw stats. Maps deterministically to EngineParameters. */
  stats?: EngineStats;

  // ── New 4D-weight path ──────────────────────────────────────────────────
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

  createdAt: number;
  updatedAt: number;
}

/** Result of statsToParameters() — flat MasterStrategy-compatible shape. */
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
