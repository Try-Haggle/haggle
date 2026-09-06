/**
 * Negotiation preset types.
 *
 * Layered on top of agent-stats: presets here express the *negotiation* shape
 * (4D weights + a few engine knobs) without committing to the full 8-stat
 * system. New default flow uses these; the 8-stat editor remains as the
 * Advanced path.
 *
 * See docs/wip/협상엔진-에이전트-업데이트-계획-2026-05-09.md §3, §7.
 */

/** Preset IDs. */
export type NegotiationAgentPresetId = "hunter" | "closer" | "verifier" | "balancer";

/** 4D negotiation weight vector. Components sum to 1.0. */
export interface NegotiationWeights {
  /** Price emphasis — higher means more reluctance to move on price. */
  w_p: number;
  /** Time emphasis — higher means more willingness to trade price for speed. */
  w_t: number;
  /** Risk emphasis — higher means more weight on counterparty/info quality. */
  w_r: number;
  /** Social/relationship emphasis — higher means more weight on rapport. */
  w_s: number;
}

/** Role-aware copy for one preset / one role. */
export interface NegotiationAgentPresetCopy {
  /** English primary name shown in the card. */
  name: string;
  /** Korean subname rendered next to or below the English name. */
  nameKo: string;
  /** One-line tagline (≤ ~50 chars). */
  tagline: string;
  /** 1–2 sentence description shown when the preset is focused. */
  description: string;
}

/**
 * A negotiation preset.
 *
 * Option C: presets declare 16 of the 17 EngineParameters fields directly.
 * Only the 3 market-awareness fields (gamma, market_utilization,
 * cross_pressure_sensitivity) stay neutral across presets; w_info is derived
 * from w_rep. See docs/wip/engine-params-and-preset-fields-2026-05-12.html.
 */
export interface NegotiationAgentPreset {
  id: NegotiationAgentPresetId;
  /**
   * Default avatar — an animal slug from `AGENT_ANIMALS`. Named `emoji`
   * because that is the persisted key in `negotiation_agent_config`, and rows
   * written before animals existed hold an emoji glyph there; render through
   * `resolveAgentAvatar`, never by hand.
   */
  emoji: string;
  /** Tailwind-friendly accent color (hex). */
  accentColor: string;

  // ── Tier 1: weight allocation (sum = 1.0) ─────────────────────────────
  weights: NegotiationWeights;

  // ── Tier 2: behavior curves (per-field envelope) ──────────────────────
  /** Time-pressure curve exponent. Envelope: [0.3, 3.0]. Higher = utility decays faster as deadline approaches. */
  alpha: number;
  /** Faratin concession curve. Envelope: [0.3, 3.0]. <1 = boulware (slow), >1 = conceder (fast). */
  beta: number;
  /** Walk-away utility floor. Envelope: [0.3, 0.85]. Higher = stricter. */
  u_threshold: number;
  /** Aspiration utility — ACCEPT trigger. Envelope: [0.3, 0.85]. Must exceed u_threshold. */
  u_aspiration: number;

  // ── Tier 3: dimension sub-parameters ──────────────────────────────────
  /** Opening anchor strength. Envelope: [0, 1]. Lower = more extreme anchor. (price) */
  anchor_ratio: number;
  /** Time-utility floor under deadline pressure. Envelope: [0, 1]. Higher = holds firm at deadline. (time) */
  v_t_floor: number;
  /** Reputation weight inside v_r. Envelope: [0, 1]. w_info is derived as 1 - w_rep. (risk) */
  w_rep: number;
  /** Minimum acceptable counterparty reputation. Envelope: [0, 1]. Higher = pickier. (risk) */
  r_score_minimum: number;
  /** Minimum acceptable information completeness. Envelope: [0, 1]. Higher = demands more proof. (risk) */
  i_completeness_minimum: number;
  /** Baseline relationship utility. Envelope: [0, 1]. Higher = relationship felt sooner. (social) */
  v_s_base: number;
  /** Number of past trades that solidify the relationship. Envelope: [5, 15] integer. Lower = faster bonding. (social) */
  n_threshold: number;
  /** Late-round aggression multiplier. Envelope: [0.5, 1.5]. Higher = pushes harder near deadline. (social) */
  late_round_aggression_modifier: number;

  /** Role-aware display copy. */
  copy: {
    buyer: NegotiationAgentPresetCopy;
    seller: NegotiationAgentPresetCopy;
  };
}

/** Default preset selected when nothing is chosen. */
export const DEFAULT_NEGOTIATION_AGENT_PRESET_ID: NegotiationAgentPresetId = "balancer";
