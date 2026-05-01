import { describe, expect, it } from 'vitest';
import {
  aggregateHnpTrustScore,
  createHnpTrustEvent,
  validateHnpTrustEvent,
} from '../src/index.js';

describe('HNP trust graph primitives', () => {
  it('creates hash-bound trust events', () => {
    const event = createHnpTrustEvent({
      subject_agent_id: 'seller-agent-1',
      subject_role: 'SELLER',
      event_type: 'settlement_completed',
      score_delta: 0.8,
      weight: 2,
      source_ref: { agreement_id: 'agr-1' },
      occurred_at_ms: 1_777_000_000_000,
    });

    expect(event.event_id).toMatch(/^trust_[a-f0-9]{24}$/);
    expect(event.event_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(validateHnpTrustEvent(event, { verifyHash: true })).toEqual({ ok: true, warnings: [] });
  });

  it('rejects invalid score, weight, subject, and timestamps', () => {
    const event = createHnpTrustEvent({
      subject_agent_id: '',
      subject_role: 'AGENT',
      event_type: 'protocol_compliance',
      score_delta: 2,
      weight: 0,
      occurred_at_ms: 0,
    });

    const result = validateHnpTrustEvent(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_SUBJECT' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_SCORE_DELTA' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_WEIGHT' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_OCCURRED_AT' }));
    }
  });

  it('detects tampered trust events', () => {
    const event = createHnpTrustEvent({
      subject_agent_id: 'buyer-agent-1',
      subject_role: 'BUYER',
      event_type: 'payment_reliability',
      score_delta: 0.6,
      occurred_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpTrustEvent({
      ...event,
      score_delta: -0.6,
    }, { verifyHash: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'HASH_MISMATCH' }));
  });

  it('aggregates weighted trust score for a subject', () => {
    const events = [
      createHnpTrustEvent({
        subject_agent_id: 'seller-agent-1',
        subject_role: 'SELLER',
        event_type: 'settlement_completed',
        score_delta: 1,
        weight: 2,
        occurred_at_ms: 1_777_000_000_000,
      }),
      createHnpTrustEvent({
        subject_agent_id: 'seller-agent-1',
        subject_role: 'SELLER',
        event_type: 'dispute_resolved',
        score_delta: -0.5,
        weight: 1,
        occurred_at_ms: 1_777_000_100_000,
      }),
      createHnpTrustEvent({
        subject_agent_id: 'other-agent',
        subject_role: 'SELLER',
        event_type: 'settlement_failed',
        score_delta: -1,
        weight: 10,
        occurred_at_ms: 1_777_000_200_000,
      }),
    ];

    const score = aggregateHnpTrustScore('seller-agent-1', 'SELLER', events);

    expect(score.event_count).toBe(2);
    expect(score.weighted_score).toBe(0.5);
    expect(score.confidence).toBe(0.15);
    expect(score.dimensions.settlement_completed).toBe(0.667);
    expect(score.dimensions.dispute_resolved).toBe(-0.167);
    expect(score.last_event_at_ms).toBe(1_777_000_100_000);
  });
});
