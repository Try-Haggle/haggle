import type {
  CategoryFeatureRule,
  FeatureApplication,
  NegotiationContext,
} from "@haggle/engine-core";
import { applyFeatures } from "@haggle/engine-core";
import type { CoreMemory } from "../types.js";

const DEFAULT_WEIGHTS = { w_p: 0.4, w_t: 0.25, w_r: 0.2, w_s: 0.15 };

/**
 * Bridge (H1): build the engine-core `NegotiationContext` from CoreMemory + extracted
 * features. Production currently BYPASSES engine-core, so this assembly is NEW work —
 * it is the seam the whole hybrid (HAGGLE-0 결정부) stands on.
 *
 * STUB status: the field mapping below is a starting skeleton. Items marked TODO(H1a)
 * need a real data source (or a confirmed default) before this drives decisions.
 * Feature routing (H6) is wired via `applyFeatures`; apply `features.adjustments` to
 * V_p with `adjustVpForFeatures` inside the utility path.
 */
export function assembleNegotiationContext(
  memory: CoreMemory,
  categoryRules: readonly CategoryFeatureRule[] = [],
): { context: NegotiationContext; features: FeatureApplication } {
  const b = memory.boundaries;
  const sp = memory.strategy_params;
  const features = applyFeatures(memory.extracted_features ?? [], categoryRules);

  const context: NegotiationContext = {
    weights: sp?.weights ?? DEFAULT_WEIGHTS,
    price: {
      p_effective: b.opponent_offer,
      p_target: b.my_target,
      p_limit: b.my_floor,
    },
    time: {
      // TODO(H1a): use session.created_at_ms / deadline_at_ms for real elapsed/deadline.
      t_elapsed: 0,
      t_deadline: 1,
      alpha: sp?.alpha ?? 1,
      v_t_floor: sp?.v_t_floor ?? 0,
    },
    risk: {
      // TODO(H1a): r_score from trust (coach already fetches); i_completeness source?
      r_score: 0.5,
      i_completeness: 0.5,
      w_rep: 0.5,
      w_info: 0.5,
    },
    relationship: {
      // TODO(H1a): n_success / n_dispute_losses source (relationship history).
      n_success: 0,
      n_dispute_losses: 0,
      n_threshold: 10,
      v_s_base: 0.5,
    },
  };

  return { context, features };
}
