/**
 * Dynamic Acceptance Threshold (Section 11.3)
 *
 * R(t) = max{ U_BATNA(t), U_min + (U_0 - U_min)(1 - τ(t)^β) }
 *
 * Accept iff: U_total(ω_opp, c_t) >= R(t)
 */

import { clamp } from '../utils.js';
import type { AcceptanceThresholdParams } from './types.js';

/**
 * Compute the dynamic acceptance threshold R(t).
 * The agent should accept any offer whose U_total >= R(t).
 *
 * As τ → 1 (deadline approaches), R(t) drops toward U_min.
 * R(t) is always at least U_BATNA.
 */
export function computeAcceptanceThreshold(params: AcceptanceThresholdParams): number {
  const { u_batna, u_min, u_0, tau, beta } = params;

  // Guard: negative tau → treat as tau=0 (negotiation hasn't started)
  // Guard: beta <= 0 → step function (no decay until tau=1)
  const safeTau = clamp(tau, 0, 1);
  let aspiration: number;
  if (beta <= 0) {
    aspiration = safeTau >= 1 ? u_min : u_0;
  } else {
    aspiration = u_min + (u_0 - u_min) * (1 - Math.pow(safeTau, beta));
  }

  // Never go below BATNA
  return Math.max(u_batna, aspiration);
}
