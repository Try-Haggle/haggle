import type { HnpRole } from '../protocol/types.js';
import type { OpponentMove, OpponentMoveType, NegotiationRange } from './types.js';

/** Minimum magnitude to distinguish from SILENT (noise threshold). */
const SILENT_THRESHOLD = 1e-6;

/**
 * Classify the opponent's price movement as CONCESSION, SELFISH, or SILENT.
 *
 * - CONCESSION: opponent moved price toward our preference
 *   (buyer raises price, seller lowers price)
 * - SELFISH: opponent moved price away from our preference
 * - SILENT: price unchanged (within noise threshold)
 *
 * Magnitude is normalized to [0, 1] relative to the negotiation range.
 */
export function classifyMove(
  prevPrice: number,
  currentPrice: number,
  senderRole: HnpRole,
  range: NegotiationRange,
): OpponentMove {
  const delta = currentPrice - prevPrice;
  const rangeSize = Math.abs(range.p_limit - range.p_target);

  // Guard against zero-width range
  const magnitude = rangeSize > 0 ? Math.abs(delta) / rangeSize : 0;

  if (Math.abs(delta) < SILENT_THRESHOLD) {
    return { type: 'SILENT', magnitude: 0 };
  }

  let type: OpponentMoveType;

  // Buyer concedes by raising price, seller concedes by lowering price
  if (senderRole === 'BUYER') {
    type = delta > 0 ? 'CONCESSION' : 'SELFISH';
  } else {
    type = delta < 0 ? 'CONCESSION' : 'SELFISH';
  }

  return { type, magnitude: Math.min(magnitude, 1) };
}
