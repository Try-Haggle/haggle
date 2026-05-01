import { describe, expect, it } from 'vitest';
import {
  createHnpAgreementObject,
  createHnpListingEvidenceBundle,
  validateHnpListingEvidenceBundle,
} from '../src/index.js';

const validImageHash = `sha256:${'a'.repeat(64)}`;

describe('HNP listing evidence bundle', () => {
  it('creates a deterministic bundle hash for product identity and evidence claims', () => {
    const bundle = createHnpListingEvidenceBundle({
      subject: {
        family: 'iphone',
        model: '15',
        variant: {
          storage: '128gb',
          carrier: 'unlocked',
        },
      },
      evidence: [
        {
          evidence_id: 'img-1',
          kind: 'image',
          uri: 'ipfs://listing/photo-1',
          sha256: validImageHash,
          content_type: 'image/jpeg',
        },
      ],
      claims: [
        {
          claim_id: 'claim-storage',
          issue_id: 'hnp.issue.product.storage',
          value: '128gb',
          confidence: 0.91,
          source_evidence_ids: ['img-1'],
        },
      ],
      created_at_ms: 1_777_000_000_000,
    });

    expect(bundle.bundle_id).toMatch(/^leb_[a-f0-9]{24}$/);
    expect(bundle.bundle_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(validateHnpListingEvidenceBundle(bundle, { verifyHash: true })).toEqual({ ok: true, warnings: [] });
  });

  it('rejects bundles without evidence', () => {
    const bundle = createHnpListingEvidenceBundle({
      subject: { family: 'iphone', model: '15' },
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpListingEvidenceBundle(bundle);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_EVIDENCE' }));
  });

  it('detects duplicate evidence ids and unknown claim sources', () => {
    const bundle = createHnpListingEvidenceBundle({
      subject: { family: 'iphone', model: '15' },
      evidence: [
        { evidence_id: 'img-1', kind: 'image' },
        { evidence_id: 'img-1', kind: 'condition_report' },
      ],
      claims: [
        {
          claim_id: 'claim-battery',
          issue_id: 'hnp.issue.condition.battery_health',
          value: 91,
          source_evidence_ids: ['missing-evidence'],
        },
      ],
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpListingEvidenceBundle(bundle);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_EVIDENCE_ID' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_CLAIM_SOURCE' }));
    }
  });

  it('rejects empty subject and claims without sources', () => {
    const bundle = createHnpListingEvidenceBundle({
      subject: { family: '   ' },
      evidence: [{ evidence_id: 'img-1', kind: 'image' }],
      claims: [
        {
          claim_id: '',
          issue_id: '',
          value: '128gb',
          source_evidence_ids: [],
        },
      ],
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpListingEvidenceBundle(bundle);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_SUBJECT' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_CLAIM_ID' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_ISSUE_ID' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_CLAIM_SOURCES' }));
    }
  });

  it('detects tampered bundle contents when hash verification is enabled', () => {
    const bundle = createHnpListingEvidenceBundle({
      subject: { family: 'iphone', model: '15' },
      evidence: [{ evidence_id: 'img-1', kind: 'image', sha256: validImageHash }],
      claims: [],
      created_at_ms: 1_777_000_000_000,
    });

    const tampered = {
      ...bundle,
      subject: { ...bundle.subject, model: '14' },
    };

    const result = validateHnpListingEvidenceBundle(tampered, { verifyHash: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'HASH_MISMATCH' }));
  });

  it('lets agreement objects bind accepted terms to a listing evidence bundle', () => {
    const bundle = createHnpListingEvidenceBundle({
      subject: { family: 'iphone', model: '15' },
      evidence: [{ evidence_id: 'img-1', kind: 'image', sha256: validImageHash }],
      created_at_ms: 1_777_000_000_000,
    });

    const agreement = createHnpAgreementObject({
      session_id: 'sess-1',
      accepted_message_id: 'msg-accept',
      accepted_proposal_id: 'prop-1',
      accepted_proposal_hash: 'sha256:proposal',
      listing_evidence_bundle_hash: bundle.bundle_hash,
      created_at_ms: 1_777_000_001_000,
    });

    expect(agreement.listing_evidence_bundle_hash).toBe(bundle.bundle_hash);
    expect(agreement.agreement_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
