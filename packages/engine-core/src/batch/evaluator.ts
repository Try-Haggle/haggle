import type { NegotiationContext } from '../types.js';
import { computeUtility } from '../utility/index.js';
import type { BatchEvaluateRequest, BatchEvaluateResult, RankedListing } from './types.js';

/**
 * Evaluate N listings with the same strategy, rank by u_total descending.
 */
export function batchEvaluate(request: BatchEvaluateRequest): BatchEvaluateResult {
  const { strategy, listings } = request;
  const results: RankedListing[] = [];
  let errors = 0;

  for (const listing of listings) {
    const ctx: NegotiationContext = {
      weights: strategy.weights,
      price: {
        p_effective: listing.p_effective,
        p_target: strategy.p_target,
        p_limit: strategy.p_limit,
      },
      time: strategy.time,
      risk: {
        r_score: listing.r_score,
        i_completeness: listing.i_completeness,
        w_rep: strategy.w_rep ?? 0.6,
        w_info: strategy.w_info ?? 0.4,
      },
      relationship: {
        n_success: listing.n_success ?? 0,
        n_dispute_losses: listing.n_dispute_losses ?? 0,
        n_threshold: strategy.n_threshold,
        v_s_base: strategy.v_s_base ?? 0.5,
      },
      competition: listing.competition,
      gamma: strategy.gamma,
    };

    const utility = computeUtility(ctx);
    if (utility.error) {
      errors++;
      continue;
    }

    results.push({
      listing_id: listing.listing_id,
      rank: 0, // assigned after sort
      u_total: utility.u_total,
      utility,
    });
  }

  results.sort((a, b) => b.u_total - a.u_total);
  for (let i = 0; i < results.length; i++) {
    results[i].rank = i + 1;
  }

  return {
    rankings: results,
    evaluated: results.length,
    errors,
  };
}
