/**
 * Multi-Issue Opponent Model
 *
 * Extends the v1 EMA model to track per-issue concession rates,
 * estimate opponent's issue priorities, and classify overall behavior.
 *
 * Signals tracked (from Section 12):
 * - Per-issue concession rate
 * - Issue priority estimation (which issues opponent concedes on most)
 * - Response speed
 * - Overall concession style
 */

import type { IssueDefinition, IssueDirection, IssueValues } from '@haggle/engine-core';
import type { HnpRole } from '../protocol/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-issue concession tracking. */
export interface IssueConcesssionTracker {
  /** EMA of concession magnitude for this issue. */
  concession_rate: number;
  /** Number of observed moves. */
  move_count: number;
  /** Total concession magnitude (for priority estimation). */
  total_concession: number;
}

/** Multi-issue opponent model. */
export interface MultiIssueOpponentModel {
  /** Per-issue concession trackers. */
  issue_trackers: Record<string, IssueConcesssionTracker>;
  /** Estimated issue priorities (normalized, sum to 1). */
  estimated_priorities: Record<string, number>;
  /** Overall concession style. */
  concession_style: 'aggressive' | 'moderate' | 'slow';
  /** Total rounds observed. */
  total_rounds: number;
  /** Average response time in ms (if available). */
  avg_response_time_ms?: number;
}

/** A multi-issue move observation. */
export interface MultiIssueMoveObservation {
  /** Previous offer values. */
  previous: IssueValues;
  /** Current offer values. */
  current: IssueValues;
  /** Opponent's role. */
  sender_role: HnpRole;
  /** Response time in ms (optional). */
  response_time_ms?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EMA_ALPHA = 0.3;
const SILENT_THRESHOLD = 1e-6;

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/** Create a fresh multi-issue opponent model. */
export function createMultiIssueOpponentModel(): MultiIssueOpponentModel {
  return {
    issue_trackers: {},
    estimated_priorities: {},
    concession_style: 'moderate',
    total_rounds: 0,
  };
}

/**
 * Classify a single issue move direction and magnitude.
 * Returns a signed value: positive = concession, negative = selfish, ~0 = silent.
 *
 * Uses issue direction to determine what counts as a concession:
 * - lower_better (e.g. price for buyer): lowering = conceding for seller, raising = conceding for buyer
 * - higher_better (e.g. warranty for buyer): raising = conceding for seller, lowering = conceding for buyer
 */
function classifyIssueMoveValue(
  prev: number,
  curr: number,
  senderRole: HnpRole,
  rangeSize: number,
  direction: IssueDirection,
): number {
  const delta = curr - prev;
  if (Math.abs(delta) < SILENT_THRESHOLD) return 0;

  const magnitude = rangeSize > 0 ? Math.abs(delta) / rangeSize : 0;
  const normalizedMag = Math.min(magnitude, 1);

  // Concession = moving toward the OTHER party's preference direction.
  // lower_better: lower values are preferred by the issue holder
  //   - Buyer wants lower → Buyer concedes by raising (accepting higher)
  //   - Seller wants higher → Seller concedes by lowering (accepting lower)
  // higher_better: higher values are preferred
  //   - Buyer wants higher → Buyer concedes by lowering (accepting lower)
  //   - Seller wants lower → Seller concedes by raising (accepting higher)
  const buyerConcessionIsRaise = direction === 'lower_better';

  if (senderRole === 'BUYER') {
    const isConcession = buyerConcessionIsRaise ? delta > 0 : delta < 0;
    return isConcession ? normalizedMag : -normalizedMag;
  }
  // Seller concession is opposite of buyer concession
  const sellerConcessionIsRaise = !buyerConcessionIsRaise;
  const isConcession = sellerConcessionIsRaise ? delta > 0 : delta < 0;
  return isConcession ? normalizedMag : -normalizedMag;
}

/**
 * Update the multi-issue opponent model with a new observation.
 * Returns a new model — does not mutate.
 */
export function updateMultiIssueOpponentModel(
  model: MultiIssueOpponentModel,
  observation: MultiIssueMoveObservation,
  definitions: IssueDefinition[],
  emaAlpha: number = DEFAULT_EMA_ALPHA,
): MultiIssueOpponentModel {
  const newTrackers = { ...model.issue_trackers };

  for (const def of definitions) {
    if (def.category !== 'negotiable') continue;

    const prev = observation.previous[def.name];
    const curr = observation.current[def.name];
    if (prev === undefined || curr === undefined) continue;

    let observed: number;

    if (def.type === 'scalar' || def.type === 'deadline') {
      const rangeSize = (def.max ?? 1) - (def.min ?? 0);
      const direction: IssueDirection = def.direction ?? (def.type === 'deadline' ? 'lower_better' : 'higher_better');
      observed = classifyIssueMoveValue(
        prev as number,
        curr as number,
        observation.sender_role,
        rangeSize,
        direction,
      );
    } else if (def.type === 'enum') {
      // Enum: track whether the opponent moved to a different value
      // Use index position in values array to determine concession direction
      const values = def.values ?? [];
      const prevIdx = values.indexOf(prev as string);
      const currIdx = values.indexOf(curr as string);
      if (prevIdx === -1 || currIdx === -1) continue;
      if (prevIdx === currIdx) {
        observed = 0; // silent
      } else {
        const rangeSize = Math.max(values.length - 1, 1);
        const direction: IssueDirection = def.direction ?? 'lower_better';
        observed = classifyIssueMoveValue(
          prevIdx,
          currIdx,
          observation.sender_role,
          rangeSize,
          direction,
        );
      }
    } else if (def.type === 'boolean') {
      // Boolean: changing = concession magnitude 1.0, same = silent
      if (prev === curr) {
        observed = 0;
      } else {
        // Concession = moving to the less preferred value for the sender
        observed = 0.5; // Treat boolean changes as moderate concession
      }
    } else {
      continue;
    }

    const existing = newTrackers[def.name] ?? {
      concession_rate: 0,
      move_count: 0,
      total_concession: 0,
    };

    const newCount = existing.move_count + 1;
    const newRate = newCount === 1
      ? observed
      : emaAlpha * observed + (1 - emaAlpha) * existing.concession_rate;

    newTrackers[def.name] = {
      concession_rate: newRate,
      move_count: newCount,
      total_concession: existing.total_concession + Math.max(0, observed),
    };
  }

  // Estimate priorities: issues with most total concession → higher priority
  const totalConcession = Object.values(newTrackers)
    .reduce((sum, t) => sum + t.total_concession, 0);

  let newPriorities: Record<string, number>;
  if (totalConcession > 0) {
    newPriorities = {};
    for (const [name, tracker] of Object.entries(newTrackers)) {
      newPriorities[name] = tracker.total_concession / totalConcession;
    }
  } else {
    // Preserve previous priorities on all-silent rounds
    newPriorities = { ...model.estimated_priorities };
  }

  // Classify overall style
  const avgRate = Object.values(newTrackers).length > 0
    ? Object.values(newTrackers).reduce((sum, t) => sum + t.concession_rate, 0) /
      Object.values(newTrackers).length
    : 0;

  let style: MultiIssueOpponentModel['concession_style'];
  if (avgRate > 0.3) style = 'aggressive';
  else if (avgRate > 0.1) style = 'moderate';
  else style = 'slow';

  // Track response time
  const newTotalRounds = model.total_rounds + 1;
  let avgTime = model.avg_response_time_ms;
  if (observation.response_time_ms !== undefined) {
    avgTime = avgTime !== undefined
      ? emaAlpha * observation.response_time_ms + (1 - emaAlpha) * avgTime
      : observation.response_time_ms;
  }

  return {
    issue_trackers: newTrackers,
    estimated_priorities: newPriorities,
    concession_style: style,
    total_rounds: newTotalRounds,
    avg_response_time_ms: avgTime,
  };
}

/**
 * Get the opponent's estimated reservation value for an issue.
 * Simple heuristic: if concession rate is slowing, their current position
 * is likely near their reservation.
 */
export function estimateReservation(
  model: MultiIssueOpponentModel,
  issueName: string,
  currentValue: number,
): number | null {
  const tracker = model.issue_trackers[issueName];
  if (!tracker || tracker.move_count < 2) return null;

  // If concession rate is very low, they're near their limit
  if (Math.abs(tracker.concession_rate) < 0.05) {
    return currentValue;
  }

  return null;
}
