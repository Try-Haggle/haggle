import { describe, expect, it } from 'vitest';
import {
  createHnpAgreementObject,
  createHnpTransactionHandoff,
  createHnpTransactionHandoffFromSignals,
  deriveHnpTransactionHandoffStatus,
  getHnpTransactionNextAction,
  summarizeHnpTransactionHandoffChain,
  validateHnpTransactionHandoff,
  validateHnpTransactionHandoffChain,
  validateHnpTransactionHandoffTransition,
} from '../src/index.js';

const proposalHash = `sha256:${'a'.repeat(64)}`;
const listingHash = `sha256:${'b'.repeat(64)}`;
const paymentPolicyHash = `sha256:${'c'.repeat(64)}`;
const shippingTermsHash = `sha256:${'d'.repeat(64)}`;
const disputePacketHash = `sha256:${'e'.repeat(64)}`;
const trustEventHash = `sha256:${'f'.repeat(64)}`;

describe('HNP transaction handoff', () => {
  it('binds agreement, listing, payment, shipping, and trust references into one handoff', () => {
    const agreement = createHnpAgreementObject({
      session_id: 'sess-1',
      accepted_message_id: 'msg-accept',
      accepted_proposal_id: 'prop-1',
      accepted_proposal_hash: proposalHash,
      listing_evidence_bundle_hash: listingHash,
      payment_approval_policy_hash: paymentPolicyHash,
      shipping_terms_hash: shippingTermsHash,
      created_at_ms: 1_777_000_000_000,
    });

    const handoff = createHnpTransactionHandoff({
      agreement_hash: agreement.agreement_hash,
      status: 'ready_for_settlement',
      listing_evidence_bundle_hash: agreement.listing_evidence_bundle_hash,
      payment_approval_policy_hash: agreement.payment_approval_policy_hash,
      shipping_terms_hash: agreement.shipping_terms_hash,
      trust_event_hashes: [trustEventHash],
      created_at_ms: 1_777_000_001_000,
    });

    expect(agreement.payment_approval_policy_hash).toBe(paymentPolicyHash);
    expect(agreement.shipping_terms_hash).toBe(shippingTermsHash);
    expect(handoff.handoff_id).toMatch(/^handoff_[a-f0-9]{24}$/);
    expect(handoff.next_action).toBe('prepare_settlement');
    expect(validateHnpTransactionHandoff(handoff, { verifyHash: true })).toEqual({ ok: true, warnings: [] });
  });

  it('requires an approval reason when status needs human approval', () => {
    const handoff = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'needs_human_approval',
      created_at_ms: 1_777_000_001_000,
    });

    const result = validateHnpTransactionHandoff(handoff);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_APPROVAL_REASON' }));
  });

  it('rejects empty and duplicate approval reasons', () => {
    const handoff = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'needs_human_approval',
      required_human_approvals: ['buyer_budget_override', ' ', 'buyer_budget_override'],
      created_at_ms: 1_777_000_001_000,
    });

    const result = validateHnpTransactionHandoff(handoff);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_APPROVAL_REASON' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_APPROVAL_REASON' }));
    }
  });

  it('requires block reasons when status is blocked', () => {
    const handoff = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'blocked',
      created_at_ms: 1_777_000_001_000,
    });

    const result = validateHnpTransactionHandoff(handoff);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_BLOCK_REASON' }));
  });

  it('rejects empty and duplicate block reasons', () => {
    const handoff = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'blocked',
      blocking_reasons: ['policy_blocked', '', 'policy_blocked'],
      created_at_ms: 1_777_000_001_000,
    });

    const result = validateHnpTransactionHandoff(handoff);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_BLOCK_REASON' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_BLOCK_REASON' }));
    }
  });

  it('rejects dispute evidence unless the handoff is disputed', () => {
    const handoff = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'ready_for_settlement',
      dispute_evidence_packet_hashes: [disputePacketHash],
      created_at_ms: 1_777_000_001_000,
    });

    const result = validateHnpTransactionHandoff(handoff);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INCONSISTENT_STATUS' }));
  });

  it('detects invalid and duplicate reference hashes', () => {
    const handoff = createHnpTransactionHandoff({
      agreement_hash: 'bad-hash',
      status: 'disputed',
      dispute_evidence_packet_hashes: [disputePacketHash, disputePacketHash, 'bad-dispute-hash'],
      created_at_ms: 1_777_000_001_000,
    });

    const result = validateHnpTransactionHandoff(handoff);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_AGREEMENT_HASH' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_REFERENCE_HASH' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_REFERENCE_HASH' }));
    }
  });

  it('detects tampered handoff contents', () => {
    const handoff = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'ready_for_settlement',
      created_at_ms: 1_777_000_001_000,
    });

    const result = validateHnpTransactionHandoff({
      ...handoff,
      status: 'settled',
    }, { verifyHash: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'HASH_MISMATCH' }));
  });

  it('rejects a next action that does not match the handoff status', () => {
    const handoff = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'ready_for_settlement',
      next_action: 'open_dispute_review',
      created_at_ms: 1_777_000_001_000,
    });

    const result = validateHnpTransactionHandoff(handoff);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_NEXT_ACTION' }));
  });

  it('derives the next transaction handoff status from payment and dispute state', () => {
    expect(deriveHnpTransactionHandoffStatus({
      payment_decision: 'AUTO_APPROVE',
    })).toBe('ready_for_settlement');

    expect(deriveHnpTransactionHandoffStatus({
      payment_decision: 'HUMAN_APPROVAL_REQUIRED',
    })).toBe('needs_human_approval');

    expect(deriveHnpTransactionHandoffStatus({
      payment_decision: 'BLOCKED',
    })).toBe('blocked');

    expect(deriveHnpTransactionHandoffStatus({
      payment_decision: 'AUTO_APPROVE',
      settlement_completed: true,
    })).toBe('settled');

    expect(deriveHnpTransactionHandoffStatus({
      payment_decision: 'BLOCKED',
      dispute_evidence_packet_hashes: [disputePacketHash],
    })).toBe('disputed');
  });

  it('maps transaction status to the next operational action', () => {
    expect(getHnpTransactionNextAction('ready_for_settlement')).toBe('prepare_settlement');
    expect(getHnpTransactionNextAction('needs_human_approval')).toBe('request_human_approval');
    expect(getHnpTransactionNextAction('blocked')).toBe('stop_transaction');
    expect(getHnpTransactionNextAction('settled')).toBe('record_settlement_complete');
    expect(getHnpTransactionNextAction('disputed')).toBe('open_dispute_review');
  });

  it('builds handoff from payment and dispute signals', () => {
    const needsApproval = createHnpTransactionHandoffFromSignals({
      agreement_hash: proposalHash,
      payment_decision: 'HUMAN_APPROVAL_REQUIRED',
      payment_reasons: ['above_approval_threshold', '', 'above_approval_threshold'],
      created_at_ms: 1_777_000_001_000,
    });

    expect(needsApproval.status).toBe('needs_human_approval');
    expect(needsApproval.next_action).toBe('request_human_approval');
    expect(needsApproval.required_human_approvals).toEqual(['above_approval_threshold']);
    expect(validateHnpTransactionHandoff(needsApproval, { verifyHash: true })).toEqual({ ok: true, warnings: [] });

    const blocked = createHnpTransactionHandoffFromSignals({
      agreement_hash: proposalHash,
      payment_decision: 'BLOCKED',
      payment_reasons: ['above_hard_limit'],
      created_at_ms: 1_777_000_001_000,
    });

    expect(blocked.status).toBe('blocked');
    expect(blocked.next_action).toBe('stop_transaction');
    expect(blocked.blocking_reasons).toEqual(['above_hard_limit']);
    expect(validateHnpTransactionHandoff(blocked, { verifyHash: true })).toEqual({ ok: true, warnings: [] });

    const disputed = createHnpTransactionHandoffFromSignals({
      agreement_hash: proposalHash,
      payment_decision: 'BLOCKED',
      payment_reasons: ['above_hard_limit'],
      dispute_evidence_packet_hashes: [disputePacketHash],
      created_at_ms: 1_777_000_001_000,
    });

    expect(disputed.status).toBe('disputed');
    expect(disputed.next_action).toBe('open_dispute_review');
    expect(disputed.blocking_reasons).toEqual([]);
    expect(validateHnpTransactionHandoff(disputed, { verifyHash: true })).toEqual({ ok: true, warnings: [] });
  });

  it('validates allowed handoff status transitions for the same agreement', () => {
    const ready = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'ready_for_settlement',
      created_at_ms: 1_777_000_001_000,
    });
    const settled = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'settled',
      created_at_ms: 1_777_000_002_000,
    });
    const disputed = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'disputed',
      dispute_evidence_packet_hashes: [disputePacketHash],
      created_at_ms: 1_777_000_003_000,
    });

    expect(validateHnpTransactionHandoffTransition(ready, settled)).toEqual({ ok: true, warnings: [] });
    expect(validateHnpTransactionHandoffTransition(settled, disputed)).toEqual({ ok: true, warnings: [] });
  });

  it('rejects handoff transitions across agreements, backward time, or blocked reactivation', () => {
    const blocked = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'blocked',
      blocking_reasons: ['above_hard_limit'],
      created_at_ms: 1_777_000_002_000,
    });
    const reactivated = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'ready_for_settlement',
      created_at_ms: 1_777_000_003_000,
    });
    const differentAgreement = createHnpTransactionHandoff({
      agreement_hash: listingHash,
      status: 'ready_for_settlement',
      created_at_ms: 1_777_000_003_000,
    });
    const earlier = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'blocked',
      blocking_reasons: ['above_hard_limit'],
      created_at_ms: 1_777_000_001_000,
    });

    const reactivationResult = validateHnpTransactionHandoffTransition(blocked, reactivated);
    expect(reactivationResult.ok).toBe(false);
    if (!reactivationResult.ok) {
      expect(reactivationResult.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }));
    }

    const agreementResult = validateHnpTransactionHandoffTransition(blocked, differentAgreement);
    expect(agreementResult.ok).toBe(false);
    if (!agreementResult.ok) {
      expect(agreementResult.issues).toContainEqual(expect.objectContaining({ code: 'AGREEMENT_HASH_CHANGED' }));
      expect(agreementResult.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }));
    }

    const timeResult = validateHnpTransactionHandoffTransition(blocked, earlier);
    expect(timeResult.ok).toBe(false);
    if (!timeResult.ok) {
      expect(timeResult.issues).toContainEqual(expect.objectContaining({ code: 'NON_MONOTONIC_TIME' }));
    }
  });

  it('validates a full handoff chain', () => {
    const ready = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'ready_for_settlement',
      created_at_ms: 1_777_000_001_000,
    });
    const settled = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'settled',
      created_at_ms: 1_777_000_002_000,
    });
    const disputed = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'disputed',
      dispute_evidence_packet_hashes: [disputePacketHash],
      created_at_ms: 1_777_000_003_000,
    });

    expect(validateHnpTransactionHandoffChain([ready, settled, disputed], { verifyHash: true })).toEqual({ ok: true, warnings: [] });
  });

  it('summarizes a handoff chain with a stable chain hash', () => {
    const ready = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'ready_for_settlement',
      created_at_ms: 1_777_000_001_000,
    });
    const settled = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'settled',
      created_at_ms: 1_777_000_002_000,
    });

    const summary = summarizeHnpTransactionHandoffChain([ready, settled]);

    expect(summary).toEqual(expect.objectContaining({
      agreement_hash: proposalHash,
      handoff_count: 2,
      first_status: 'ready_for_settlement',
      current_status: 'settled',
      current_next_action: 'record_settlement_complete',
      started_at_ms: 1_777_000_001_000,
      updated_at_ms: 1_777_000_002_000,
      terminal: false,
      handoff_hashes: [ready.handoff_hash, settled.handoff_hash],
    }));
    expect(summary?.chain_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(summarizeHnpTransactionHandoffChain([])).toBeUndefined();
  });

  it('marks blocked handoff chains as terminal', () => {
    const blocked = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'blocked',
      blocking_reasons: ['above_hard_limit'],
      created_at_ms: 1_777_000_001_000,
    });

    const summary = summarizeHnpTransactionHandoffChain([blocked]);

    expect(summary).toEqual(expect.objectContaining({
      current_status: 'blocked',
      current_next_action: 'stop_transaction',
      terminal: true,
    }));
  });

  it('does not summarize invalid handoff chains', () => {
    const blocked = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'blocked',
      blocking_reasons: ['above_hard_limit'],
      created_at_ms: 1_777_000_001_000,
    });
    const invalidReactivation = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'ready_for_settlement',
      created_at_ms: 1_777_000_002_000,
    });

    expect(summarizeHnpTransactionHandoffChain([blocked, invalidReactivation])).toBeUndefined();
  });

  it('does not summarize tampered handoff chains when hash verification is requested', () => {
    const ready = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'ready_for_settlement',
      created_at_ms: 1_777_000_001_000,
    });

    expect(summarizeHnpTransactionHandoffChain([{
      ...ready,
      created_at_ms: 1_777_000_002_000,
    }], { verifyHash: true })).toBeUndefined();
  });

  it('reports invalid handoff chain entries and transitions with indexes', () => {
    const blocked = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'blocked',
      blocking_reasons: ['above_hard_limit'],
      created_at_ms: 1_777_000_002_000,
    });
    const invalidReactivation = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'ready_for_settlement',
      created_at_ms: 1_777_000_003_000,
    });
    const invalidHandoff = createHnpTransactionHandoff({
      agreement_hash: proposalHash,
      status: 'needs_human_approval',
      created_at_ms: 1_777_000_004_000,
    });

    const result = validateHnpTransactionHandoffChain([blocked, invalidReactivation, invalidHandoff]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: 'INVALID_TRANSITION',
        index: 1,
        cause_code: 'INVALID_STATUS_TRANSITION',
      }));
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: 'INVALID_HANDOFF',
        index: 2,
        cause_code: 'MISSING_APPROVAL_REASON',
      }));
    }
  });

  it('rejects an empty handoff chain', () => {
    const result = validateHnpTransactionHandoffChain([]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_CHAIN', index: -1 }));
  });
});
