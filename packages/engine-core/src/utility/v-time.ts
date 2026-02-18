import type { TimeContext } from '../types.js';

/**
 * Compute V_t (time utility).
 * V_t = max(v_t_floor, (max(0, 1 - t_elapsed / t_deadline))^alpha)
 */
export function computeVt(time: TimeContext): number {
  const { t_elapsed, t_deadline, alpha, v_t_floor } = time;
  const vtRaw = Math.max(0, 1 - t_elapsed / t_deadline) ** alpha;
  return Math.max(v_t_floor, vtRaw);
}
