import { describe, expect, it } from 'vitest';
import {
  createHnpPaymentApprovalPolicy,
  evaluateHnpPaymentApproval,
  validateHnpPaymentApprovalPolicy,
} from '../src/index.js';

describe('HNP payment approval policy', () => {
  it('auto-approves prices within the user-delegated limit', () => {
    const policy = createHnpPaymentApprovalPolicy({
      role: 'BUYER',
      currency: 'usd',
      auto_approve_up_to_minor: 45_000,
      require_approval_above_minor: 45_000,
      hard_limit_minor: 50_000,
      escrow_required: true,
      refund_path_required: true,
      created_at_ms: 1_777_000_000_000,
    });

    const result = evaluateHnpPaymentApproval({
      policy,
      proposed_price: { currency: 'USD', units_minor: 44_000 },
      settlement_mode: 'escrow',
      refund_path_available: true,
    });

    expect(policy.policy_id).toMatch(/^pap_[a-f0-9]{24}$/);
    expect(validateHnpPaymentApprovalPolicy(policy, { verifyHash: true })).toEqual({ ok: true, warnings: [] });
    expect(result).toEqual({ decision: 'AUTO_APPROVE', reasons: ['within_auto_approval_limit'] });
  });

  it('requires human approval above the approval threshold but below the hard limit', () => {
    const policy = createHnpPaymentApprovalPolicy({
      role: 'BUYER',
      currency: 'USD',
      auto_approve_up_to_minor: 45_000,
      require_approval_above_minor: 45_000,
      hard_limit_minor: 50_000,
      created_at_ms: 1_777_000_000_000,
    });

    const result = evaluateHnpPaymentApproval({
      policy,
      proposed_price: { currency: 'USD', units_minor: 48_000 },
    });

    expect(result).toEqual({ decision: 'HUMAN_APPROVAL_REQUIRED', reasons: ['above_approval_threshold'] });
  });

  it('blocks proposals above the hard spend limit', () => {
    const policy = createHnpPaymentApprovalPolicy({
      role: 'BUYER',
      currency: 'USD',
      hard_limit_minor: 50_000,
      created_at_ms: 1_777_000_000_000,
    });

    const result = evaluateHnpPaymentApproval({
      policy,
      proposed_price: { currency: 'USD', units_minor: 50_001 },
    });

    expect(result).toEqual({ decision: 'BLOCKED', reasons: ['above_hard_limit'] });
  });

  it('blocks invalid negative or fractional proposed prices', () => {
    const policy = createHnpPaymentApprovalPolicy({
      role: 'BUYER',
      currency: 'USD',
      hard_limit_minor: 50_000,
      created_at_ms: 1_777_000_000_000,
    });

    expect(evaluateHnpPaymentApproval({
      policy,
      proposed_price: { currency: 'USD', units_minor: -1 },
    })).toEqual({ decision: 'BLOCKED', reasons: ['invalid_price'] });

    expect(evaluateHnpPaymentApproval({
      policy,
      proposed_price: { currency: 'USD', units_minor: 10.5 },
    })).toEqual({ decision: 'BLOCKED', reasons: ['invalid_price'] });
  });

  it('requires human approval when escrow or refund paths are missing', () => {
    const policy = createHnpPaymentApprovalPolicy({
      role: 'BUYER',
      currency: 'USD',
      auto_approve_up_to_minor: 45_000,
      escrow_required: true,
      refund_path_required: true,
      created_at_ms: 1_777_000_000_000,
    });

    const result = evaluateHnpPaymentApproval({
      policy,
      proposed_price: { currency: 'USD', units_minor: 40_000 },
      settlement_mode: 'manual',
      refund_path_available: false,
    });

    expect(result).toEqual({
      decision: 'HUMAN_APPROVAL_REQUIRED',
      reasons: ['escrow_required', 'refund_path_required'],
    });
  });

  it('detects invalid thresholds and tampered policy hashes', () => {
    const policy = createHnpPaymentApprovalPolicy({
      role: 'BUYER',
      currency: 'USD',
      auto_approve_up_to_minor: 55_000,
      hard_limit_minor: 50_000,
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpPaymentApprovalPolicy({
      ...policy,
      hard_limit_minor: 49_000,
    }, { verifyHash: true });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVERTED_LIMITS' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'HASH_MISMATCH' }));
    }
  });

  it('rejects fractional policy limits', () => {
    const policy = createHnpPaymentApprovalPolicy({
      role: 'BUYER',
      currency: 'USD',
      auto_approve_up_to_minor: 45_000.5,
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpPaymentApprovalPolicy(policy);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'NON_INTEGER_LIMIT' }));
  });
});
