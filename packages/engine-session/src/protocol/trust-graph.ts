import { createHash } from 'node:crypto';

export const HNP_TRUST_EVENT_TYPES = [
  'protocol_compliance',
  'settlement_completed',
  'settlement_failed',
  'cancellation',
  'dispute_opened',
  'dispute_resolved',
  'evidence_quality',
  'payment_reliability',
] as const;

export type HnpTrustEventType = (typeof HNP_TRUST_EVENT_TYPES)[number];
export type HnpTrustSubjectRole = 'BUYER' | 'SELLER' | 'AGENT' | 'MEDIATOR';

export interface HnpTrustEvent {
  event_id: string;
  subject_agent_id: string;
  subject_role: HnpTrustSubjectRole;
  event_type: HnpTrustEventType;
  score_delta: number;
  weight: number;
  source_ref?: {
    agreement_id?: string;
    session_id?: string;
    packet_hash?: string;
    message_id?: string;
  };
  occurred_at_ms: number;
  event_hash: string;
}

export interface CreateHnpTrustEventInput {
  subject_agent_id: string;
  subject_role: HnpTrustSubjectRole;
  event_type: HnpTrustEventType;
  score_delta: number;
  weight?: number;
  source_ref?: HnpTrustEvent['source_ref'];
  occurred_at_ms: number;
}

export interface HnpTrustScore {
  subject_agent_id: string;
  subject_role: HnpTrustSubjectRole;
  event_count: number;
  weighted_score: number;
  confidence: number;
  dimensions: Record<HnpTrustEventType, number>;
  last_event_at_ms?: number;
}

export interface HnpTrustEventIssue {
  code:
    | 'MISSING_SUBJECT'
    | 'UNSUPPORTED_EVENT_TYPE'
    | 'INVALID_SCORE_DELTA'
    | 'INVALID_WEIGHT'
    | 'INVALID_OCCURRED_AT'
    | 'HASH_MISMATCH';
  field: string;
  message: string;
}

export type HnpTrustEventValidationResult =
  | { ok: true; warnings: HnpTrustEventIssue[] }
  | { ok: false; issues: HnpTrustEventIssue[] };

export function createHnpTrustEvent(input: CreateHnpTrustEventInput): HnpTrustEvent {
  const base = {
    subject_agent_id: input.subject_agent_id,
    subject_role: input.subject_role,
    event_type: input.event_type,
    score_delta: input.score_delta,
    weight: input.weight ?? 1,
    source_ref: input.source_ref,
    occurred_at_ms: input.occurred_at_ms,
  };
  const eventHash = computeHnpTrustEventHash(base);
  return {
    event_id: `trust_${eventHash.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    ...base,
    event_hash: eventHash,
  };
}

export function computeHnpTrustEventHash(
  value: Omit<HnpTrustEvent, 'event_id' | 'event_hash'>,
): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function validateHnpTrustEvent(
  event: HnpTrustEvent,
  options: { verifyHash?: boolean } = {},
): HnpTrustEventValidationResult {
  const issues: HnpTrustEventIssue[] = [];

  if (!event.subject_agent_id.trim()) {
    issues.push(issue('MISSING_SUBJECT', 'subject_agent_id', 'Trust event must identify a subject agent.'));
  }

  if (!isSupportedTrustEventType(event.event_type)) {
    issues.push(issue('UNSUPPORTED_EVENT_TYPE', 'event_type', `Unsupported trust event type: ${event.event_type}`));
  }

  if (!Number.isFinite(event.score_delta) || event.score_delta < -1 || event.score_delta > 1) {
    issues.push(issue('INVALID_SCORE_DELTA', 'score_delta', 'Score delta must be between -1 and 1.'));
  }

  if (!Number.isFinite(event.weight) || event.weight <= 0 || event.weight > 10) {
    issues.push(issue('INVALID_WEIGHT', 'weight', 'Trust event weight must be > 0 and <= 10.'));
  }

  if (!Number.isFinite(event.occurred_at_ms) || event.occurred_at_ms <= 0) {
    issues.push(issue('INVALID_OCCURRED_AT', 'occurred_at_ms', 'Trust event time must be a positive timestamp.'));
  }

  if (options.verifyHash) {
    const expectedHash = computeHnpTrustEventHash({
      subject_agent_id: event.subject_agent_id,
      subject_role: event.subject_role,
      event_type: event.event_type,
      score_delta: event.score_delta,
      weight: event.weight,
      source_ref: event.source_ref,
      occurred_at_ms: event.occurred_at_ms,
    });
    if (event.event_hash !== expectedHash) {
      issues.push(issue('HASH_MISMATCH', 'event_hash', 'Trust event hash does not match event contents.'));
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, warnings: [] };
}

export function aggregateHnpTrustScore(
  subject_agent_id: string,
  subject_role: HnpTrustSubjectRole,
  events: HnpTrustEvent[],
): HnpTrustScore {
  const matchingEvents = events.filter((event) => (
    event.subject_agent_id === subject_agent_id
    && event.subject_role === subject_role
  ));

  let weightedTotal = 0;
  let weightTotal = 0;
  const dimensions = Object.fromEntries(
    HNP_TRUST_EVENT_TYPES.map((eventType) => [eventType, 0]),
  ) as Record<HnpTrustEventType, number>;

  for (const event of matchingEvents) {
    weightedTotal += event.score_delta * event.weight;
    weightTotal += event.weight;
    dimensions[event.event_type] += event.score_delta * event.weight;
  }

  const weightedScore = weightTotal === 0 ? 0 : clamp(weightedTotal / weightTotal, -1, 1);
  return {
    subject_agent_id,
    subject_role,
    event_count: matchingEvents.length,
    weighted_score: round3(weightedScore),
    confidence: round3(clamp(weightTotal / 20, 0, 1)),
    dimensions: Object.fromEntries(
      Object.entries(dimensions).map(([key, value]) => [key, round3(clamp(value / Math.max(weightTotal, 1), -1, 1))]),
    ) as Record<HnpTrustEventType, number>,
    last_event_at_ms: matchingEvents
      .map((event) => event.occurred_at_ms)
      .sort((a, b) => b - a)[0],
  };
}

function isSupportedTrustEventType(eventType: string): eventType is HnpTrustEventType {
  return (HNP_TRUST_EVENT_TYPES as readonly string[]).includes(eventType);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function issue(
  code: HnpTrustEventIssue['code'],
  field: string,
  message: string,
): HnpTrustEventIssue {
  return { code, field, message };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalize(record[key]);
      return acc;
    }, {});
}
