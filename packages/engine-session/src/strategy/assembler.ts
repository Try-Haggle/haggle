import type { NegotiationContext } from '@haggle/engine-core';
import type { MasterStrategy } from './types.js';
import type { RoundData } from './types.js';

/**
 * Assembles a NegotiationContext from a MasterStrategy and per-round data.
 *
 * This is the core bridge function: "strategy + current situation → engine-core input".
 * MasterStrategy holds the invariant strategy parameters, while RoundData holds
 * the situational data that changes every round.
 */
export function assembleContext(strategy: MasterStrategy, roundData: RoundData): NegotiationContext {
  return {
    weights: strategy.weights,
    price: {
      p_effective: roundData.p_effective,
      p_target: strategy.p_target,
      p_limit: strategy.p_limit,
    },
    time: {
      t_elapsed: roundData.t_elapsed,
      t_deadline: strategy.t_deadline,
      alpha: strategy.alpha,
      v_t_floor: strategy.v_t_floor,
    },
    risk: {
      r_score: roundData.r_score,
      i_completeness: roundData.i_completeness,
      w_rep: strategy.w_rep,
      w_info: strategy.w_info,
    },
    relationship: {
      n_success: roundData.n_success,
      n_dispute_losses: roundData.n_dispute_losses,
      n_threshold: strategy.n_threshold,
      v_s_base: strategy.v_s_base,
    },
    competition: roundData.competition,
    gamma: strategy.gamma,
  };
}
