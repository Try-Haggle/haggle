/**
 * Listing Detail v2 — shared types.
 *
 * `ListingDetail` mirrors the shape the current page already receives from
 * `/api/public/listings/:publicId` (see app/l/[publicId]/page.tsx) so that
 * adopting v2 is a component swap, not a data-layer change.
 */

export interface ListingDetail {
  id: string;
  publicId: string;
  publishedAt: string;
  title: string;
  description: string | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  tags: string[] | null;
  sellerAgentPreset: string | null;
  sellingDeadline: string | null;
  /** The seller's REQUIRED category criteria (buyer-safe: id + ask). */
  sellerRequiredCriteria: Array<{ checkId: string; ask: string }> | null;
  /**
   * Product facts the seller answered with canonical options, as spec cards.
   * Category-agnostic: any taxonomy check the seller answered publishes. This
   * replaced the phone-only `subtype`/`attributes` pair, which was removed
   * along with the phone question flow. Facts only — never negotiation posture.
   */
  specs?: Array<{ checkId: string; label: string; value: string }> | null;
  sellerFulfillmentOffer?: {
    options: Array<{ method: string; radius_miles?: number; max_weight_lb?: number }>;
    preferred?: string;
  } | null;
  parcel?: {
    weight_oz: number;
    length_in?: number;
    width_in?: number;
    height_in?: number;
  } | null;
}

export interface ViewerInfo {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export type ListingOrigin = "browse" | "buy-dashboard" | "sell-dashboard";

/**
 * Strategy overrides accumulated on this page, on top of the picked preset.
 *
 * The deal surface deliberately does NOT carry the full `AgentBuilderState` —
 * that model belongs to the Agent Studio. Here the buyer diverges from the
 * preset through the negotiator panel: the weight dials, the briefing chat
 * numericizing what they said (weights + the four behaviour curves), and the
 * panel's advanced sliders (the remaining engine knobs). All of it fits this
 * one sparse shape — every field beyond `weights` is optional and falls back
 * to the preset — and `onStart` hands it to the caller so the negotiation is
 * started with what the buyer actually tuned, not the bare preset.
 *
 * Field set mirrors the 16 preset-declared engine fields (the same ones the
 * studio's AdvancedOverrides edits), so adoption can forward it as
 * `agent_overrides` without translation.
 */
export interface StrategyOverride {
  weights: { w_p: number; w_t: number; w_r: number; w_s: number };
  alpha?: number;
  beta?: number;
  u_threshold?: number;
  u_aspiration?: number;
  anchor_ratio?: number;
  v_t_floor?: number;
  w_rep?: number;
  r_score_minimum?: number;
  i_completeness_minimum?: number;
  v_s_base?: number;
  n_threshold?: number;
  late_round_aggression_modifier?: number;
}
