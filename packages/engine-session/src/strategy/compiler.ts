import type { MasterStrategy } from "./types.js";

export type StrategyRole = "BUYER" | "SELLER";

/**
 * The single resolved personality form (4D weights + behavior curves) the
 * compiler consumes. Structurally a subset of `@haggle/shared`'s
 * `EngineParameters` — the API passes the full resolved EngineParameters here.
 * Plain object so engine-session keeps zero dependency on @haggle/shared.
 *
 * This replaced the legacy 5-stat (`priceAggression…`) and 8-stat
 * (`anchoring…`) inputs: presets/advanced/builder-chat all resolve to this one
 * shape before reaching the engine.
 */
export type EngineParamsInput = {
  weights: { w_p: number; w_t: number; w_r: number; w_s: number };
  alpha: number;
  beta: number;
  u_threshold: number;
  u_aspiration: number;
  anchor_ratio: number;
  v_t_floor: number;
  w_rep: number;
  v_s_base: number;
  n_threshold: number;
  late_round_aggression_modifier?: number;
  gamma?: number;
};

export type StrategyCompilerInput = {
  role: StrategyRole;
  userId?: string;
  strategyId?: string;
  /** Display label for persona / selected_playbook (e.g. the preset id). */
  preset?: string;
  /** The resolved personality (weights + curves). The one and only strategy input. */
  params: EngineParamsInput;
  userPreferences?: Record<string, unknown> | null;
  listing: {
    id?: string;
    category?: string | null;
    condition?: string | null;
    targetPriceMinor: number;
    floorPriceMinor: number;
    listedAtMs: number;
    deadlineAtMs?: number | null;
  };
  nowMs?: number;
};

export type CompiledNegotiationAgentSnapshot = MasterStrategy & {
  compiler: {
    version: "strategy-compiler-v2";
    source: "engine_params";
    selected_playbook: string;
    candidate_playbooks: string[];
  };
  role: StrategyRole;
  p_reservation: number;
  p_initial: number;
  t_max: number;
  created_at_ms: number;
  deadline_at_ms: number;
  time_value: {
    curve: "faratin";
    listed_at_ms: number;
    deadline_at_ms: number;
    t_total_ms: number;
    beta: number;
    source: "listing_selling_deadline" | "compiler_default_window";
  };
  utility_weights: {
    price: number;
    time: number;
    reputation: number;
    satisfaction: number;
  };
  thresholds: {
    accept: number;
    counter: number;
    reject: number;
    near_deal: number;
  };
  concession: {
    beta: number;
    k: number;
  };
  /** Opening-anchor strength [0,1]; lower = more extreme anchor. */
  anchor_ratio: number;
  /** Late-round aggression multiplier (when supplied by the agent). */
  late_round_aggression_modifier?: number;
  listing_context: {
    id?: string;
    category?: string | null;
    condition?: string | null;
  };
  user_preference_ref?: Record<string, unknown>;
};

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Compile a resolved agent personality + a specific listing's prices/deadline
 * into a per-session MasterStrategy snapshot.
 *
 * The personality (weights + curves) is taken verbatim from `params`; the
 * listing supplies the deal-specific price boundaries and time window. There is
 * no stat→parameter math anymore — the preset/advanced/builder-chat layer
 * already produced engine-space values.
 */
export function compileNegotiationAgentSnapshot(
  input: StrategyCompilerInput,
): CompiledNegotiationAgentSnapshot {
  const p = input.params;
  const nowMs = input.nowMs ?? Date.now();
  const listedAtMs = saneMillis(input.listing.listedAtMs, nowMs);
  const deadlineAtMs = Math.max(
    listedAtMs + 1,
    saneMillis(input.listing.deadlineAtMs, listedAtMs + DEFAULT_WINDOW_MS),
  );
  const totalMs = Math.max(1, deadlineAtMs - listedAtMs);

  const weights = normalizeWeights({
    price: p.weights.w_p,
    time: p.weights.w_t,
    reputation: p.weights.w_r,
    satisfaction: p.weights.w_s,
  });
  const wRep = clamp01(p.w_rep);
  const wInfo = round3(1 - wRep);
  const uAspiration = clamp01(p.u_aspiration);
  const uThreshold = clamp01(p.u_threshold);
  const beta = p.beta;
  const presetLabel = input.preset ?? "compiled";

  const pTarget = Math.max(1, input.listing.targetPriceMinor);
  const rawLimit = Math.max(1, input.listing.floorPriceMinor);
  const pLimit =
    input.role === "SELLER" ? Math.min(pTarget, rawLimit) : Math.max(pTarget, rawLimit);

  return {
    id: input.strategyId ?? `${input.role.toLowerCase()}_${presetLabel}`,
    user_id: input.userId ?? "",
    role: input.role,
    persona: presetLabel,
    weights: {
      w_p: weights.price,
      w_t: weights.time,
      w_r: weights.reputation,
      w_s: weights.satisfaction,
    },
    p_target: pTarget,
    p_limit: pLimit,
    p_reservation: pLimit,
    p_initial: pTarget,
    alpha: p.alpha,
    beta,
    t_deadline: totalMs,
    t_max: totalMs,
    v_t_floor: p.v_t_floor,
    n_threshold: p.n_threshold,
    v_s_base: p.v_s_base,
    w_rep: wRep,
    w_info: wInfo,
    u_threshold: uThreshold,
    u_aspiration: uAspiration,
    gamma: p.gamma ?? 0.1,
    created_at: listedAtMs,
    expires_at: deadlineAtMs,
    created_at_ms: listedAtMs,
    deadline_at_ms: deadlineAtMs,
    time_value: {
      curve: "faratin",
      listed_at_ms: listedAtMs,
      deadline_at_ms: deadlineAtMs,
      t_total_ms: totalMs,
      beta,
      source: input.listing.deadlineAtMs ? "listing_selling_deadline" : "compiler_default_window",
    },
    utility_weights: {
      price: weights.price,
      time: weights.time,
      reputation: weights.reputation,
      satisfaction: weights.satisfaction,
    },
    thresholds: {
      accept: round3(uAspiration),
      counter: round3(uThreshold),
      reject: round3(Math.max(0, uThreshold - 0.25)),
      near_deal: round3(Math.max(0, uAspiration - 0.06)),
    },
    concession: { beta, k: 1.0 },
    anchor_ratio: clamp01(p.anchor_ratio),
    ...(p.late_round_aggression_modifier != null
      ? { late_round_aggression_modifier: p.late_round_aggression_modifier }
      : {}),
    compiler: {
      version: "strategy-compiler-v2",
      source: "engine_params",
      selected_playbook: presetLabel,
      candidate_playbooks: [presetLabel],
    },
    listing_context: {
      id: input.listing.id,
      category: input.listing.category,
      condition: input.listing.condition,
    },
    user_preference_ref: input.userPreferences ?? undefined,
  };
}

function normalizeWeights(input: {
  price: number;
  time: number;
  reputation: number;
  satisfaction: number;
}) {
  const total = input.price + input.time + input.reputation + input.satisfaction || 1;
  const price = round6(input.price / total);
  const time = round6(input.time / total);
  const reputation = round6(input.reputation / total);

  return {
    price,
    time,
    reputation,
    satisfaction: round6(1 - price - time - reputation),
  };
}

function saneMillis(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp01(value: number): number {
  return clamp(typeof value === "number" && Number.isFinite(value) ? value : 0, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
