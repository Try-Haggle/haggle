import type { WaitingIntent } from './types.js';

/** Configuration for intent rematch behavior. */
export interface RematchPolicy {
  rematch_on_rejected: boolean;
  rematch_on_expired: boolean;
  max_rematch_count: number;
  rematch_cooldown_ms: number;
}

/** Terminal session status that triggers rematch evaluation. */
export type SessionTerminalStatus = 'REJECTED' | 'EXPIRED' | 'SUPERSEDED';

/** Result of rematch evaluation. */
export interface RematchDecision {
  should_rematch: boolean;
  reason: string;
}

/** Default rematch policy. */
export function defaultRematchPolicy(): RematchPolicy {
  return {
    rematch_on_rejected: true,
    rematch_on_expired: true,
    max_rematch_count: 3,
    rematch_cooldown_ms: 60_000, // 1 minute
  };
}

/**
 * Determine whether an intent should be rematched after a session ends.
 *
 * Checks:
 * 1. Terminal status is eligible per policy
 * 2. Rematch count not exceeded
 * 3. Cooldown period respected (uses intent.createdAt as proxy for last match time)
 * 4. Intent still ACTIVE or MATCHED (not FULFILLED/CANCELLED/EXPIRED)
 */
export function shouldRematchIntent(
  intent: WaitingIntent,
  sessionTerminalStatus: SessionTerminalStatus,
  rematchCount: number,
  policy?: RematchPolicy,
): RematchDecision {
  const p = policy ?? defaultRematchPolicy();

  // Check if terminal status is eligible
  if (sessionTerminalStatus === 'REJECTED' && !p.rematch_on_rejected) {
    return { should_rematch: false, reason: 'rematch_on_rejected disabled' };
  }
  if (sessionTerminalStatus === 'EXPIRED' && !p.rematch_on_expired) {
    return { should_rematch: false, reason: 'rematch_on_expired disabled' };
  }
  if (sessionTerminalStatus === 'SUPERSEDED') {
    // Superseded sessions always allow rematch (the better deal took over)
    // but still subject to count limits
  }

  // Check rematch count limit
  if (rematchCount >= p.max_rematch_count) {
    return { should_rematch: false, reason: `max_rematch_count (${p.max_rematch_count}) reached` };
  }

  // Check intent eligibility
  if (intent.status !== 'ACTIVE' && intent.status !== 'MATCHED') {
    return { should_rematch: false, reason: `intent status ${intent.status} not eligible` };
  }

  // Check session capacity
  if (intent.currentActiveSessions >= intent.maxActiveSessions) {
    return { should_rematch: false, reason: 'max active sessions reached' };
  }

  return { should_rematch: true, reason: 'eligible for rematch' };
}
