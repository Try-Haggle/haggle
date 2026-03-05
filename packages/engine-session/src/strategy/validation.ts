import { SessionError } from '../errors/types.js';
import type { MasterStrategy, RoundData } from './types.js';

const WEIGHT_TOLERANCE = 1e-6;

export function validateStrategy(strategy: MasterStrategy): SessionError | null {
  const { weights } = strategy;
  const weightSum = weights.w_p + weights.w_t + weights.w_r + weights.w_s;
  if (Math.abs(weightSum - 1.0) > WEIGHT_TOLERANCE) {
    return SessionError.INVALID_STRATEGY;
  }

  if (strategy.p_target <= 0 || strategy.p_limit <= 0) {
    return SessionError.INVALID_STRATEGY;
  }

  if (strategy.t_deadline <= 0) {
    return SessionError.INVALID_STRATEGY;
  }

  if (strategy.alpha <= 0 || strategy.beta <= 0) {
    return SessionError.INVALID_STRATEGY;
  }

  if (strategy.u_threshold < 0 || strategy.u_threshold > 1) {
    return SessionError.INVALID_STRATEGY;
  }

  if (strategy.u_aspiration < 0 || strategy.u_aspiration > 1) {
    return SessionError.INVALID_STRATEGY;
  }

  if (strategy.u_aspiration < strategy.u_threshold) {
    return SessionError.INVALID_STRATEGY;
  }

  if (strategy.expires_at <= strategy.created_at) {
    return SessionError.INVALID_STRATEGY;
  }

  return null;
}

export function validateRoundData(data: RoundData): SessionError | null {
  if (data.p_effective <= 0) {
    return SessionError.INVALID_ROUND_DATA;
  }

  if (data.r_score < 0 || data.r_score > 1) {
    return SessionError.INVALID_ROUND_DATA;
  }

  if (data.i_completeness < 0 || data.i_completeness > 1) {
    return SessionError.INVALID_ROUND_DATA;
  }

  if (data.t_elapsed < 0) {
    return SessionError.INVALID_ROUND_DATA;
  }

  if (data.n_success < 0) {
    return SessionError.INVALID_ROUND_DATA;
  }

  if (data.n_dispute_losses < 0) {
    return SessionError.INVALID_ROUND_DATA;
  }

  return null;
}
