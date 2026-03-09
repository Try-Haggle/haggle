import type { OpponentModel, OpponentMove } from './types.js';

/** Default EMA smoothing factor (higher = recent moves weighted more). */
const DEFAULT_EMA_ALPHA = 0.3;

/** Create a fresh opponent model with no observations. */
export function createOpponentModel(): OpponentModel {
  return {
    concession_rate: 0,
    move_count: 0,
    last_move: null,
  };
}

/**
 * Update the opponent model with a new classified move.
 * Returns a new object — does not mutate the input.
 *
 * Concession rate is tracked via EMA:
 * - CONCESSION: observed value = +magnitude
 * - SELFISH:    observed value = -magnitude
 * - SILENT:     observed value = 0
 *
 * For the first observation, the rate is set directly (no smoothing).
 */
export function updateOpponentModel(
  model: OpponentModel,
  move: OpponentMove,
  emaAlpha: number = DEFAULT_EMA_ALPHA,
): OpponentModel {
  let observed: number;
  switch (move.type) {
    case 'CONCESSION':
      observed = move.magnitude;
      break;
    case 'SELFISH':
      observed = -move.magnitude;
      break;
    case 'SILENT':
      observed = 0;
      break;
  }

  const newCount = model.move_count + 1;
  const newRate = newCount === 1
    ? observed
    : emaAlpha * observed + (1 - emaAlpha) * model.concession_rate;

  return {
    concession_rate: newRate,
    move_count: newCount,
    last_move: move,
  };
}
