import { describe, expect, it } from 'vitest';
import {
  createHnpDisputeEvidencePacket,
  validateHnpDisputeEvidencePacket,
} from '../src/index.js';

const agreementHash = `sha256:${'b'.repeat(64)}`;
const evidenceHash = `sha256:${'c'.repeat(64)}`;

describe('HNP dispute evidence packet', () => {
  it('creates a hash-bound dispute evidence packet', () => {
    const packet = createHnpDisputeEvidencePacket({
      agreement_id: 'agr-1',
      agreement_hash: agreementHash,
      reason: 'item_not_as_described',
      requested_resolution: 'partial_refund',
      requested_adjustment: { currency: 'USD', units_minor: 5_000 },
      evidence: [
        {
          evidence_id: 'arrival-photo-1',
          kind: 'condition_at_arrival',
          uri: 'ipfs://arrival/photo-1',
          sha256: evidenceHash,
          submitted_at_ms: 1_777_000_100_000,
        },
      ],
      findings: [
        {
          finding_id: 'battery-mismatch',
          issue_id: 'hnp.issue.condition.battery_health',
          expected: '>=90',
          observed: 84,
          severity: 'high',
          source_evidence_ids: ['arrival-photo-1'],
        },
      ],
      created_at_ms: 1_777_000_100_000,
    });

    expect(packet.packet_id).toMatch(/^dep_[a-f0-9]{24}$/);
    expect(packet.packet_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(validateHnpDisputeEvidencePacket(packet, { verifyHash: true })).toEqual({ ok: true, warnings: [] });
  });

  it('rejects packets without evidence or agreement binding', () => {
    const packet = createHnpDisputeEvidencePacket({
      agreement_id: '',
      agreement_hash: 'bad-hash',
      reason: 'other',
      requested_resolution: 'no_action',
      created_at_ms: 1_777_000_100_000,
    });

    const result = validateHnpDisputeEvidencePacket(packet);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_AGREEMENT' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_AGREEMENT_HASH' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_EVIDENCE' }));
    }
  });

  it('detects duplicate evidence ids and unknown finding sources', () => {
    const packet = createHnpDisputeEvidencePacket({
      agreement_id: 'agr-1',
      agreement_hash: agreementHash,
      reason: 'damaged_in_shipping',
      requested_resolution: 'partial_refund',
      evidence: [
        {
          evidence_id: 'photo-1',
          kind: 'condition_at_arrival',
          submitted_at_ms: 1_777_000_100_000,
        },
        {
          evidence_id: 'photo-1',
          kind: 'carrier_tracking',
          submitted_at_ms: 1_777_000_100_001,
        },
      ],
      findings: [
        {
          finding_id: 'damage',
          issue_id: 'hnp.issue.condition.grade',
          expected: 'A',
          observed: 'C',
          source_evidence_ids: ['missing'],
        },
      ],
      created_at_ms: 1_777_000_100_000,
    });

    const result = validateHnpDisputeEvidencePacket(packet);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_EVIDENCE_ID' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_FINDING_SOURCE' }));
    }
  });

  it('rejects invalid adjustments, timestamps, and empty finding sources', () => {
    const packet = createHnpDisputeEvidencePacket({
      agreement_id: 'agr-1',
      agreement_hash: agreementHash,
      reason: 'payment_issue',
      requested_resolution: 'partial_refund',
      requested_adjustment: { currency: 'USD', units_minor: -1 },
      evidence: [
        {
          evidence_id: 'payment-1',
          kind: 'payment_record',
          sha256: 'bad',
          submitted_at_ms: 0,
        },
      ],
      findings: [
        {
          finding_id: '',
          issue_id: '',
          expected: 'paid',
          observed: 'pending',
          source_evidence_ids: [],
        },
      ],
      created_at_ms: 1_777_000_100_000,
    });

    const result = validateHnpDisputeEvidencePacket(packet);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_ADJUSTMENT' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_SHA256' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_SUBMITTED_AT' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_FINDING_ID' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_ISSUE_ID' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_FINDING_SOURCES' }));
    }
  });

  it('detects tampered packets', () => {
    const packet = createHnpDisputeEvidencePacket({
      agreement_id: 'agr-1',
      agreement_hash: agreementHash,
      reason: 'non_delivery',
      requested_resolution: 'full_refund',
      evidence: [
        {
          evidence_id: 'tracking-1',
          kind: 'carrier_tracking',
          submitted_at_ms: 1_777_000_100_000,
        },
      ],
      created_at_ms: 1_777_000_100_000,
    });

    const result = validateHnpDisputeEvidencePacket({
      ...packet,
      requested_resolution: 'no_action',
    }, { verifyHash: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'HASH_MISMATCH' }));
  });
});
