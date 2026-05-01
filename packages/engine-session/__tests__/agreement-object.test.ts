import { describe, expect, it } from 'vitest';
import {
  createHnpAgreementObject,
  validateHnpAgreementObject,
} from '../src/index.js';

const proposalHash = `sha256:${'a'.repeat(64)}`;
const listingHash = `sha256:${'b'.repeat(64)}`;
const paymentPolicyHash = `sha256:${'c'.repeat(64)}`;
const shippingTermsHash = `sha256:${'d'.repeat(64)}`;

describe('HNP agreement object', () => {
  it('creates and validates a hash-bound agreement receipt', () => {
    const agreement = createHnpAgreementObject({
      session_id: 'sess-1',
      accepted_message_id: 'msg-accept',
      accepted_proposal_id: 'prop-1',
      accepted_proposal_hash: proposalHash,
      agreed_price: { currency: 'USD', units_minor: 50_000 },
      accepted_issues: [
        { issue_id: 'hnp.issue.price.total', value: 50_000, unit: 'USD', kind: 'NEGOTIABLE' },
      ],
      listing_evidence_bundle_hash: listingHash,
      payment_approval_policy_hash: paymentPolicyHash,
      shipping_terms_hash: shippingTermsHash,
      parties: [
        { agent_id: 'buyer-agent', role: 'BUYER' },
        { agent_id: 'seller-agent', role: 'SELLER' },
      ],
      settlement_preconditions: ['escrow_required', 'tracking_required'],
      created_at_ms: 1_777_000_000_000,
    });

    expect(agreement.agreement_id).toMatch(/^agr_[a-f0-9]{24}$/);
    expect(validateHnpAgreementObject(agreement, { verifyHash: true })).toEqual({ ok: true, warnings: [] });
  });

  it('rejects missing required references and invalid reference hashes', () => {
    const agreement = createHnpAgreementObject({
      session_id: '',
      accepted_message_id: '',
      accepted_proposal_id: '',
      accepted_proposal_hash: 'bad-proposal-hash',
      listing_evidence_bundle_hash: 'bad-listing-hash',
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpAgreementObject(agreement);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_SESSION' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_ACCEPTED_MESSAGE' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_ACCEPTED_PROPOSAL' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_REFERENCE_HASH' }));
    }
  });

  it('rejects invalid prices, duplicate parties, and empty preconditions', () => {
    const agreement = createHnpAgreementObject({
      session_id: 'sess-1',
      accepted_message_id: 'msg-accept',
      accepted_proposal_id: 'prop-1',
      agreed_price: { currency: 'USD', units_minor: 1.5 },
      parties: [
        { agent_id: 'buyer-agent', role: 'BUYER' },
        { agent_id: 'buyer-agent', role: 'BUYER' },
        { agent_id: '', role: 'SELLER' },
      ],
      settlement_preconditions: ['escrow_required', ''],
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpAgreementObject(agreement);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_PRICE' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_PARTY' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_PARTY_AGENT' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_PRECONDITION' }));
    }
  });

  it('detects tampered agreement contents', () => {
    const agreement = createHnpAgreementObject({
      session_id: 'sess-1',
      accepted_message_id: 'msg-accept',
      accepted_proposal_id: 'prop-1',
      agreed_price: { currency: 'USD', units_minor: 50_000 },
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpAgreementObject({
      ...agreement,
      agreed_price: { currency: 'USD', units_minor: 49_000 },
    }, { verifyHash: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'HASH_MISMATCH' }));
  });
});
