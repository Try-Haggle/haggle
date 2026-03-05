import type { NegotiationSession } from './types.js';
import type { MasterStrategy } from '../strategy/types.js';

const TERMINAL_STATUSES = new Set(['ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED']);

export function checkTimeout(
  session: NegotiationSession,
  strategy: MasterStrategy,
  now: number,
): boolean {
  if (TERMINAL_STATUSES.has(session.status)) {
    return false;
  }
  return now - session.created_at >= strategy.t_deadline * 1000;
}
