import type {
  CompetitionContext,
  TimeContext,
  UtilityResult,
  UtilityWeights,
} from '../types.js';
import type { DecisionThresholds } from '../decision/types.js';

export interface ListingInput {
  listing_id: string;
  p_effective: number;
  r_score: number;
  i_completeness: number;
  n_success?: number;
  n_dispute_losses?: number;
  competition?: CompetitionContext;
}

export interface BatchStrategy {
  weights: UtilityWeights;
  p_target: number;
  p_limit: number;
  time: TimeContext;
  n_threshold: number;
  w_rep?: number;
  w_info?: number;
  v_s_base?: number;
  gamma?: number;
}

export interface BatchEvaluateRequest {
  strategy: BatchStrategy;
  listings: ListingInput[];
}

export interface RankedListing {
  listing_id: string;
  rank: number;
  u_total: number;
  utility: UtilityResult;
}

export interface BatchEvaluateResult {
  rankings: RankedListing[];
  evaluated: number;
  errors: number;
}

export interface SessionSnapshot {
  session_id: string;
  utility: UtilityResult;
  thresholds: DecisionThresholds;
}

export interface SessionCompareResult {
  rankings: { session_id: string; rank: number; u_total: number }[];
  batna?: number;
  recommended_action: 'CONTINUE' | 'ACCEPT_BEST' | 'ESCALATE';
}
