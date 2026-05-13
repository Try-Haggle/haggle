/**
 * Per-field UI descriptions for the Advanced Settings sliders.
 *
 * Every editable preset field has:
 *   - `label`: short slider label
 *   - `tier`: 1 (weights), 2 (curves), 3 (sub-params)
 *   - `dimension`: which 4D axis it belongs to (or 'curve' for behavior knobs)
 *   - `envelope`: [min, max] valid range
 *   - `left` / `right`: trade-off text shown at slider ends
 *   - `hint`: optional one-line tooltip
 */

export type FieldTier = 1 | 2 | 3;
export type FieldDimension = "price" | "time" | "risk" | "social" | "curve";

export interface FieldDescriptor {
  field: string;
  label: string;
  tier: FieldTier;
  dimension: FieldDimension;
  envelope: [number, number];
  step?: number;
  integer?: boolean;
  left: string;
  right: string;
  hint?: string;
}

export const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
  // ── Tier 1: weights (sum = 1.0) ──────────────────────────────────────
  {
    field: "w_p",
    label: "Price",
    tier: 1,
    dimension: "price",
    envelope: [0, 1],
    step: 0.01,
    left: "Price matters less — willing to trade price for other priorities",
    right: "Price is #1 — willing to give up speed, trust, rapport for it",
    hint: "How much price drives the decision vs. other dimensions.",
  },
  {
    field: "w_t",
    label: "Time",
    tier: 1,
    dimension: "time",
    envelope: [0, 1],
    step: 0.01,
    left: "Take your time — no rush to close",
    right: "Speed is #1 — accept worse price to close fast",
    hint: "How much closing speed matters.",
  },
  {
    field: "w_r",
    label: "Risk",
    tier: 1,
    dimension: "risk",
    envelope: [0, 1],
    step: 0.01,
    left: "Take chances — proceed with limited info",
    right: "Trust & verification first — won't deal without solid signals",
    hint: "How much counterparty trust drives the decision.",
  },
  {
    field: "w_s",
    label: "Social",
    tier: 1,
    dimension: "social",
    envelope: [0, 1],
    step: 0.01,
    left: "One-shot deal — relationship doesn't matter",
    right: "Repeat business — invest in rapport for future trades",
    hint: "How much long-term relationship is valued.",
  },

  // ── Tier 2: behavior curves ──────────────────────────────────────────
  {
    field: "alpha",
    label: "Time Pressure",
    tier: 2,
    dimension: "curve",
    envelope: [0.3, 3.0],
    step: 0.05,
    left: "Calm — barely flinches as deadline nears",
    right: "Anxious — utility drops sharply near deadline",
    hint: "How strongly approaching deadline pushes the agent to concede.",
  },
  {
    field: "beta",
    label: "Concession Speed",
    tier: 2,
    dimension: "curve",
    envelope: [0.3, 3.0],
    step: 0.05,
    left: "Boulware — holds line, concedes only at the end",
    right: "Conceder — gives ground early to keep the deal alive",
    hint: "How quickly the counter-offer moves toward the walk-away price.",
  },
  {
    field: "u_threshold",
    label: "Walk-Away Threshold",
    tier: 2,
    dimension: "curve",
    envelope: [0.3, 0.85],
    step: 0.01,
    left: "Lenient — accepts most offers, rarely walks",
    right: "Strict — quickly rejects, walks away often",
    hint: "Minimum utility before the agent abandons the negotiation.",
  },
  {
    field: "u_aspiration",
    label: "Acceptance Target",
    tier: 2,
    dimension: "curve",
    envelope: [0.3, 0.85],
    step: 0.01,
    left: "Easy ACCEPT — okay with mediocre deals",
    right: "Demanding ACCEPT — only locks in great deals",
    hint: "Utility level that triggers an instant ACCEPT. Must exceed walk-away.",
  },

  // ── Tier 3: sub-parameters ───────────────────────────────────────────
  {
    field: "anchor_ratio",
    label: "Opening Anchor",
    tier: 3,
    dimension: "price",
    envelope: [0, 1],
    step: 0.05,
    left: "Aggressive anchor — extreme opener, presses the counterparty",
    right: "Soft anchor — opens near reasonable, comfortable for the other side",
    hint: "Lower = first offer is more extreme; higher = more accommodating.",
  },
  {
    field: "v_t_floor",
    label: "Deadline Resilience",
    tier: 3,
    dimension: "time",
    envelope: [0, 1],
    step: 0.05,
    left: "Crumbles at deadline — big concessions in final rounds",
    right: "Holds firm at deadline — doesn't break under time pressure",
    hint: "Minimum time-utility even when deadline is here.",
  },
  {
    field: "w_rep",
    label: "Reputation vs. Info",
    tier: 3,
    dimension: "risk",
    envelope: [0, 1],
    step: 0.05,
    left: "Trusts data — relies on listing details & info completeness",
    right: "Trusts people — weights counterparty rating heavily",
    hint: "Split between reputation score and information completeness inside v_r.",
  },
  {
    field: "r_score_minimum",
    label: "Min. Reputation",
    tier: 3,
    dimension: "risk",
    envelope: [0, 1],
    step: 0.05,
    left: "Lenient — deals with low-rep counterparties",
    right: "Picky — only deals with high-rep counterparties",
    hint: "Floor on counterparty reputation. Below this, walk away.",
  },
  {
    field: "i_completeness_minimum",
    label: "Min. Info Completeness",
    tier: 3,
    dimension: "risk",
    envelope: [0, 1],
    step: 0.05,
    left: "Proceeds with sparse info",
    right: "Demands thorough info before engaging",
    hint: "Floor on listing/counterparty information completeness.",
  },
  {
    field: "v_s_base",
    label: "Relationship Baseline",
    tier: 3,
    dimension: "social",
    envelope: [0, 1],
    step: 0.05,
    left: "Cold start — no rapport credit by default",
    right: "Warm start — gives counterparty social credit upfront",
    hint: "Baseline social utility before any trade history.",
  },
  {
    field: "n_threshold",
    label: "Trades to Bond",
    tier: 3,
    dimension: "social",
    envelope: [5, 15],
    integer: true,
    step: 1,
    left: "Fast bonding — small history is enough",
    right: "Slow bonding — needs many trades before trust",
    hint: "Number of past successful trades that solidify the relationship.",
  },
  {
    field: "late_round_aggression_modifier",
    label: "Endgame Aggression",
    tier: 3,
    dimension: "social",
    envelope: [0.5, 1.5],
    step: 0.05,
    left: "Soft endgame — backs off in the final rounds",
    right: "Hard endgame — pushes harder as deadline closes",
    hint: "Multiplier applied to aggression in late rounds.",
  },
] as const;

/** Look up a descriptor by field name. */
export function getFieldDescriptor(field: string): FieldDescriptor | undefined {
  return FIELD_DESCRIPTORS.find((d) => d.field === field);
}

/** Descriptors grouped by tier — useful for rendering Advanced Settings sections. */
export function fieldsByTier(tier: FieldTier): FieldDescriptor[] {
  return FIELD_DESCRIPTORS.filter((d) => d.tier === tier);
}
