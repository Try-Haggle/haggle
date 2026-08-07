import type {
  CategoryFeatureRule,
  ExtractedFeature,
  FeatureApplication,
  NegotiationContext,
  UtilityWeights,
} from "@haggle/engine-core";
import { applyFeatures } from "@haggle/engine-core";

const DEFAULT_WEIGHTS: UtilityWeights = { w_p: 0.4, w_t: 0.25, w_r: 0.2, w_s: 0.15 };

/**
 * The engine knobs, read losslessly from the ONE compiled strategy form.
 *
 * Field names mirror `CompiledNegotiationAgentSnapshot` (engine-session's
 * strategy compiler). Every knob engine-core needs lives flat on that snapshot,
 * so there is no reason to route them through a second, lossy shape.
 */
interface EngineKnobs {
  weights: UtilityWeights;
  alpha: number;
  v_t_floor: number;
  w_rep: number;
  w_info: number;
  v_s_base: number;
  n_threshold: number;
  gamma: number;
  u_threshold: number;
  u_aspiration: number;
  p_target: number;
  p_limit: number;
  created_at_ms: number;
  deadline_at_ms: number;
}

/**
 * Read ALL engine knobs straight from the compiled strategy snapshot.
 *
 * WHY THIS EXISTS (read before "simplifying" it):
 * The snapshot (`negotiationAgentSnapshot`, a MasterStrategy) is the single,
 * immutable, per-session form that already carries every knob. The legacy path
 * re-extracted a 7-field subset (`CoreMemory.strategy_params` via
 * `extractStrategyParams`) that was hand-picked for the LLM/coach and silently
 * dropped w_rep / v_s_base / n_threshold / gamma — which is exactly why those
 * parameters were "dead" in production. The engine decision path must NOT reuse
 * that lossy subset; it reads the snapshot directly here so a user's tuning
 * actually reaches computeUtility/makeDecision.
 *
 * The snapshot arrives as JSON (`Record<string, unknown>`) at the DB boundary,
 * so we read defensively with per-field fallbacks (same defaults the compiler
 * uses) rather than trusting the shape.
 */
export function readEngineKnobs(snapshot: Record<string, unknown>): EngineKnobs {
  const num = (key: string, fallback: number): number => {
    const v = snapshot[key];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };

  let weights: UtilityWeights = DEFAULT_WEIGHTS;
  const w = snapshot.weights;
  if (w && typeof w === "object" && !Array.isArray(w)) {
    const wr = w as Record<string, unknown>;
    const keys = ["w_p", "w_t", "w_r", "w_s"] as const;
    if (keys.every((k) => typeof wr[k] === "number")) {
      weights = {
        w_p: wr.w_p as number,
        w_t: wr.w_t as number,
        w_r: wr.w_r as number,
        w_s: wr.w_s as number,
      };
    }
  }

  const wRep = num("w_rep", 0.5);
  return {
    weights,
    alpha: num("alpha", 1),
    v_t_floor: num("v_t_floor", 0),
    w_rep: wRep,
    // Compiler stores w_info = 1 - w_rep; recompute if absent so the pair stays consistent.
    w_info: num("w_info", 1 - wRep),
    v_s_base: num("v_s_base", 0.5),
    n_threshold: num("n_threshold", 10),
    gamma: num("gamma", 0.1),
    u_threshold: num("u_threshold", 0.5),
    u_aspiration: num("u_aspiration", 0.7),
    p_target: num("p_target", 0),
    p_limit: num("p_limit", 0),
    created_at_ms: num("created_at_ms", 0),
    deadline_at_ms: num("deadline_at_ms", 0),
  };
}

/**
 * Live, per-round facts. These genuinely change every round and CANNOT live in
 * the frozen snapshot — they are the "situation", separate from the "strategy".
 * The clock (`now_ms`) is injected by the caller so this stays pure/deterministic
 * (engine-style: no `Date.now()` inside).
 */
export interface LiveRoundFacts {
  /** Counterparty's current offer (minor units). */
  opponent_offer: number;
  /** Current wall-clock in epoch ms — injected, not read, to keep this pure. */
  now_ms: number;
  /** Structured features from the counterparty message (sensor → H5). */
  extracted_features?: ExtractedFeature[];
  // TODO(H1a): the facts below have no confirmed source yet. Wire real sources
  // (trust score, info completeness, relationship history) or lock in defaults.
  /** Counterparty reputation [0,1] — coach already fetches a trust score. */
  r_score?: number;
  /** How complete the info we have on the counterparty is [0,1]. */
  i_completeness?: number;
  /** Past successful deals with this counterparty. */
  n_success?: number;
  /** Past disputes lost against this counterparty. */
  n_dispute_losses?: number;
}

/**
 * Bridge (H1): build engine-core's `NegotiationContext` from the compiled
 * strategy snapshot + live round facts.
 *
 * WHY THIS TRANSLATION IS THE ONLY ONE WE KEEP:
 * engine-core is a pure, zero-dependency package (it cannot import API/DB types).
 * So SOMETHING has to translate our JSON snapshot into engine-core's own
 * `NegotiationContext` at this seam — that one boundary translation is the price
 * of keeping the engine reusable and unit-testable. Everything else (the lossy
 * `strategy_params` middle shape) has been removed: strategy knobs come straight
 * from the snapshot via `readEngineKnobs`, live facts come in as `LiveRoundFacts`.
 *
 * Production currently BYPASSES engine-core entirely, so this assembly is the
 * seam the whole hybrid (HAGGLE-0 결정부 / 그룹 1) stands on.
 *
 * Feature routing (H6) is wired via `applyFeatures`; apply `features.adjustments`
 * to V_p with `adjustVpForFeatures` inside the utility path (H2).
 */
export function assembleNegotiationContext(
  snapshot: Record<string, unknown>,
  live: LiveRoundFacts,
  categoryRules: readonly CategoryFeatureRule[] = [],
): { context: NegotiationContext; features: FeatureApplication } {
  const k = readEngineKnobs(snapshot);
  const features = applyFeatures(live.extracted_features ?? [], categoryRules);

  // Time: elapsed vs total window, both in ms (engine-core takes the ratio).
  const totalMs = Math.max(1, k.deadline_at_ms - k.created_at_ms);
  const elapsedMs = Math.min(totalMs, Math.max(0, live.now_ms - k.created_at_ms));

  const context: NegotiationContext = {
    weights: k.weights,
    price: {
      p_effective: live.opponent_offer,
      p_target: k.p_target,
      p_limit: k.p_limit,
    },
    time: {
      t_elapsed: elapsedMs,
      t_deadline: totalMs,
      alpha: k.alpha,
      v_t_floor: k.v_t_floor,
    },
    risk: {
      // Knobs from the snapshot; facts (r_score, i_completeness) are TODO(H1a).
      r_score: live.r_score ?? 0.5,
      i_completeness: live.i_completeness ?? 0.5,
      w_rep: k.w_rep,
      w_info: k.w_info,
    },
    relationship: {
      // Knobs from the snapshot; history facts (n_success, ...) are TODO(H1a).
      n_success: live.n_success ?? 0,
      n_dispute_losses: live.n_dispute_losses ?? 0,
      n_threshold: k.n_threshold,
      v_s_base: k.v_s_base,
    },
  };

  return { context, features };
}
