/**
 * Four negotiation presets — one per dominant axis of the 4D weight space.
 * Same weight vectors apply to buyer and seller (Q2). Copy diverges per role.
 *
 * Option C (2026-05-12): presets declare 16 of the 17 EngineParameters fields
 * directly. Sub-params reflect each preset's stance (Hunter anchors hard,
 * Verifier demands clean info, etc.). Only 3 market fields stay neutral.
 *
 * Numbers sanity-checked against the stats-to-params envelopes
 * ([0.3, 3.0] for alpha/beta, [0.3, 0.85] for u_*, [0, 1] for sub-params,
 * [5, 15] for n_threshold, [0.5, 1.5] for late-round modifier).
 */

import type { NegotiationAgentPreset } from "./types.js";

export const NEGOTIATION_AGENT_PRESETS: readonly NegotiationAgentPreset[] = [
  {
    id: "hunter",
    emoji: "🎯",
    accentColor: "#ef4444",
    weights: { w_p: 0.5, w_t: 0.15, w_r: 0.2, w_s: 0.15 },
    alpha: 0.5,
    beta: 0.4,
    u_threshold: 0.55,
    u_aspiration: 0.7,
    anchor_ratio: 0.5,
    v_t_floor: 0.7,
    w_rep: 0.5,
    r_score_minimum: 0.3,
    i_completeness_minimum: 0.3,
    v_s_base: 0.4,
    n_threshold: 12,
    late_round_aggression_modifier: 1.1,
    copy: {
      buyer: {
        name: "Bargain Hunter",
        nameKo: "가격 사냥꾼",
        tagline: "Holds out for the best price.",
        description:
          "Prioritizes price over speed. Concedes slowly and walks away if the deal isn't right.",
      },
      seller: {
        name: "Patient Lister",
        nameKo: "인내의 판매자",
        tagline: "Waits for the right buyer.",
        description: "Holds list price firm. Slow to concede, even if it takes longer to close.",
      },
    },
  },
  {
    id: "closer",
    emoji: "⚡",
    accentColor: "#f59e0b",
    weights: { w_p: 0.2, w_t: 0.5, w_r: 0.15, w_s: 0.15 },
    alpha: 2.0,
    beta: 2.0,
    u_threshold: 0.4,
    u_aspiration: 0.55,
    anchor_ratio: 0.85,
    v_t_floor: 0.3,
    w_rep: 0.5,
    r_score_minimum: 0.25,
    i_completeness_minimum: 0.25,
    v_s_base: 0.5,
    n_threshold: 10,
    late_round_aggression_modifier: 0.8,
    copy: {
      buyer: {
        name: "Quick Buyer",
        nameKo: "신속 구매자",
        tagline: "Closes fast, even at a higher price.",
        description:
          "Prioritizes speed. Concedes price quickly to lock in the deal before the seller cools.",
      },
      seller: {
        name: "Quick Closer",
        nameKo: "신속 체결자",
        tagline: "Locks in deals fast.",
        description: "Prioritizes turnover. Drops price quickly to close before the buyer walks.",
      },
    },
  },
  {
    id: "verifier",
    emoji: "🔍",
    accentColor: "#3b82f6",
    weights: { w_p: 0.25, w_t: 0.2, w_r: 0.4, w_s: 0.15 },
    alpha: 1.0,
    beta: 1.0,
    u_threshold: 0.6,
    u_aspiration: 0.75,
    anchor_ratio: 0.7,
    v_t_floor: 0.55,
    w_rep: 0.7,
    r_score_minimum: 0.55,
    i_completeness_minimum: 0.55,
    v_s_base: 0.5,
    n_threshold: 12,
    late_round_aggression_modifier: 1.0,
    copy: {
      buyer: {
        name: "Cautious Verifier",
        nameKo: "신중한 검증가",
        tagline: "Walks away if info isn't solid.",
        description:
          "Prioritizes counterparty trust and information completeness. Won't proceed without strong signals.",
      },
      seller: {
        name: "Vetted Lister",
        nameKo: "검증 우선 판매자",
        tagline: "Only deals with verified buyers.",
        description:
          "Filters for serious, verified buyers. Demands clear intent and trust signals before negotiating.",
      },
    },
  },
  {
    id: "balancer",
    emoji: "⚖️",
    accentColor: "#10b981",
    weights: { w_p: 0.3, w_t: 0.25, w_r: 0.25, w_s: 0.2 },
    alpha: 1.0,
    beta: 1.0,
    u_threshold: 0.5,
    u_aspiration: 0.65,
    anchor_ratio: 0.7,
    v_t_floor: 0.5,
    w_rep: 0.55,
    r_score_minimum: 0.35,
    i_completeness_minimum: 0.4,
    v_s_base: 0.55,
    n_threshold: 10,
    late_round_aggression_modifier: 1.0,
    copy: {
      buyer: {
        name: "Steady Buyer",
        nameKo: "균형 구매자",
        tagline: "Even-handed across price, time, and trust.",
        description: "No single dimension dominates. Safe default for most categories.",
      },
      seller: {
        name: "Steady Seller",
        nameKo: "균형 판매자",
        tagline: "Even-handed across price, time, and trust.",
        description: "No single dimension dominates. Safe default for most categories.",
      },
    },
  },
] as const;

/** Look up a preset by id. */
export function getNegotiationAgentPreset(id: string): NegotiationAgentPreset | undefined {
  return NEGOTIATION_AGENT_PRESETS.find((p) => p.id === id);
}
