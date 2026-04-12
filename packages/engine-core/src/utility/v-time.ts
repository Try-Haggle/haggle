import type { TimeContext, HoldContext } from '../types.js';

/**
 * Compute V_t (time utility).
 *
 * Base formula: V_t = max(v_t_floor, (max(0, 1 - t_elapsed / t_deadline))^alpha)
 *
 * When hold is provided and active:
 *   hold_urgency = 1 - (hold_remaining_ms / hold_total_ms)
 *   effective_alpha = alpha * (1 + 0.3 * hold_urgency)
 * This makes V_t decay faster as hold expiration approaches.
 */
export function computeVt(time: TimeContext, hold?: HoldContext): number {
  const { t_elapsed, t_deadline, v_t_floor } = time;
  let { alpha } = time;

  // Hold urgency amplifies time pressure
  if (hold?.is_held && hold.hold_remaining_ms != null && hold.hold_total_ms != null && hold.hold_total_ms > 0) {
    const holdUrgency = 1 - (hold.hold_remaining_ms / hold.hold_total_ms);
    alpha = alpha * (1 + 0.3 * holdUrgency);
  }

  const vtRaw = Math.max(0, 1 - t_elapsed / t_deadline) ** alpha;
  return Math.max(v_t_floor, vtRaw);
}
