import { describe, expect, it } from 'vitest';
import { validateHnpEnvelopeConformance } from '../src/index.js';

const validOffer = {
  spec_version: '2026-03-09',
  capability: 'hnp.core.negotiation',
  session_id: 'sess-1',
  message_id: 'msg-1',
  idempotency_key: 'idem-1',
  sequence: 1,
  sent_at_ms: 1_777_000_000_000,
  expires_at_ms: 1_777_000_060_000,
  sender_agent_id: 'buyer-agent',
  sender_role: 'BUYER' as const,
  type: 'OFFER' as const,
  payload: {
    proposal_id: 'prop-1',
    issues: [{ issue_id: 'hnp.issue.price.total', value: 50000, unit: 'USD', kind: 'NEGOTIABLE' as const }],
    total_price: { currency: 'USD', units_minor: 50000 },
  },
};

describe('HNP conformance kit', () => {
  it('accepts a valid core offer envelope', () => {
    const result = validateHnpEnvelopeConformance(validOffer, { nowMs: 1_777_000_000_001 });

    expect(result).toEqual({ ok: true, warnings: [] });
  });

  it('rejects expired messages', () => {
    const result = validateHnpEnvelopeConformance(validOffer, { nowMs: 1_777_000_060_001 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'STALE_MESSAGE', field: 'expires_at_ms' }));
  });

  it('rejects unsupported issues', () => {
    const result = validateHnpEnvelopeConformance({
      ...validOffer,
      payload: {
        ...validOffer.payload,
        issues: [{ issue_id: 'com.unknown.issue.trade_in', value: true }],
      },
    }, { nowMs: 1_777_000_000_001 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_ISSUE' }));
  });

  it('allows declared vendor issue namespaces', () => {
    const result = validateHnpEnvelopeConformance({
      ...validOffer,
      payload: {
        ...validOffer.payload,
        issues: [{ issue_id: 'com.vendor.issue.trade_in.value', value: true }],
      },
    }, {
      nowMs: 1_777_000_000_001,
      supportedIssueNamespaces: ['hnp.issue', 'com.vendor.issue.trade_in'],
    });

    expect(result.ok).toBe(true);
  });

  it('enforces detached signature when configured', () => {
    const result = validateHnpEnvelopeConformance(validOffer, {
      nowMs: 1_777_000_000_001,
      requireSignature: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'SIGNATURE_REQUIRED' }));
  });
});
