import { createHash } from 'node:crypto';
import type { HnpActorRole, HnpMoney } from './core.js';

export type HnpPaymentApprovalDecision = 'AUTO_APPROVE' | 'HUMAN_APPROVAL_REQUIRED' | 'BLOCKED';

export interface HnpPaymentApprovalPolicy {
  policy_id: string;
  role: Extract<HnpActorRole, 'BUYER' | 'SELLER'>;
  currency: string;
  auto_approve_up_to_minor?: number;
  require_approval_above_minor?: number;
  hard_limit_minor?: number;
  escrow_required?: boolean;
  refund_path_required?: boolean;
  created_at_ms: number;
  policy_hash: string;
}

export interface CreateHnpPaymentApprovalPolicyInput {
  role: Extract<HnpActorRole, 'BUYER' | 'SELLER'>;
  currency: string;
  auto_approve_up_to_minor?: number;
  require_approval_above_minor?: number;
  hard_limit_minor?: number;
  escrow_required?: boolean;
  refund_path_required?: boolean;
  created_at_ms: number;
}

export interface EvaluateHnpPaymentApprovalInput {
  policy: HnpPaymentApprovalPolicy;
  proposed_price: HnpMoney;
  settlement_mode?: string;
  refund_path_available?: boolean;
}

export interface HnpPaymentApprovalResult {
  decision: HnpPaymentApprovalDecision;
  reasons: string[];
}

export interface HnpPaymentApprovalPolicyIssue {
  code:
    | 'INVALID_CURRENCY'
    | 'NON_INTEGER_LIMIT'
    | 'NEGATIVE_LIMIT'
    | 'INVERTED_LIMITS'
    | 'HASH_MISMATCH';
  field: string;
  message: string;
}

export type HnpPaymentApprovalPolicyValidationResult =
  | { ok: true; warnings: HnpPaymentApprovalPolicyIssue[] }
  | { ok: false; issues: HnpPaymentApprovalPolicyIssue[] };

export function createHnpPaymentApprovalPolicy(
  input: CreateHnpPaymentApprovalPolicyInput,
): HnpPaymentApprovalPolicy {
  const base = {
    role: input.role,
    currency: input.currency.toUpperCase(),
    auto_approve_up_to_minor: input.auto_approve_up_to_minor,
    require_approval_above_minor: input.require_approval_above_minor,
    hard_limit_minor: input.hard_limit_minor,
    escrow_required: input.escrow_required,
    refund_path_required: input.refund_path_required,
    created_at_ms: input.created_at_ms,
  };
  const policyHash = computeHnpPaymentApprovalPolicyHash(base);
  return {
    policy_id: `pap_${policyHash.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    ...base,
    policy_hash: policyHash,
  };
}

export function computeHnpPaymentApprovalPolicyHash(
  value: Omit<HnpPaymentApprovalPolicy, 'policy_id' | 'policy_hash'>,
): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function evaluateHnpPaymentApproval(
  input: EvaluateHnpPaymentApprovalInput,
): HnpPaymentApprovalResult {
  const policy = input.policy;
  const price = input.proposed_price;
  const reasons: string[] = [];

  if (!Number.isInteger(price.units_minor) || price.units_minor < 0) {
    return { decision: 'BLOCKED', reasons: ['invalid_price'] };
  }

  if (price.currency.toUpperCase() !== policy.currency.toUpperCase()) {
    return { decision: 'BLOCKED', reasons: ['currency_mismatch'] };
  }

  if (policy.hard_limit_minor !== undefined && price.units_minor > policy.hard_limit_minor) {
    return { decision: 'BLOCKED', reasons: ['above_hard_limit'] };
  }

  if (policy.escrow_required && input.settlement_mode !== 'escrow') {
    reasons.push('escrow_required');
  }

  if (policy.refund_path_required && !input.refund_path_available) {
    reasons.push('refund_path_required');
  }

  if (
    policy.require_approval_above_minor !== undefined
    && price.units_minor > policy.require_approval_above_minor
  ) {
    reasons.push('above_approval_threshold');
  }

  if (reasons.length > 0) {
    return { decision: 'HUMAN_APPROVAL_REQUIRED', reasons };
  }

  if (
    policy.auto_approve_up_to_minor !== undefined
    && price.units_minor <= policy.auto_approve_up_to_minor
  ) {
    return { decision: 'AUTO_APPROVE', reasons: ['within_auto_approval_limit'] };
  }

  return { decision: 'HUMAN_APPROVAL_REQUIRED', reasons: ['no_auto_approval_limit'] };
}

export function validateHnpPaymentApprovalPolicy(
  policy: HnpPaymentApprovalPolicy,
  options: { verifyHash?: boolean } = {},
): HnpPaymentApprovalPolicyValidationResult {
  const issues: HnpPaymentApprovalPolicyIssue[] = [];

  if (!/^[A-Z]{3,12}$/.test(policy.currency)) {
    issues.push(issue('INVALID_CURRENCY', 'currency', 'Currency must be an uppercase currency or token symbol.'));
  }

  for (const [field, value] of [
    ['auto_approve_up_to_minor', policy.auto_approve_up_to_minor],
    ['require_approval_above_minor', policy.require_approval_above_minor],
    ['hard_limit_minor', policy.hard_limit_minor],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isInteger(value)) {
      issues.push(issue('NON_INTEGER_LIMIT', field, `${field} must be an integer minor-unit value.`));
    }
    if (value < 0) {
      issues.push(issue('NEGATIVE_LIMIT', field, `${field} cannot be negative.`));
    }
  }

  if (
    policy.auto_approve_up_to_minor !== undefined
    && policy.hard_limit_minor !== undefined
    && policy.auto_approve_up_to_minor > policy.hard_limit_minor
  ) {
    issues.push(issue('INVERTED_LIMITS', 'auto_approve_up_to_minor', 'Auto approval limit cannot exceed hard limit.'));
  }

  if (
    policy.require_approval_above_minor !== undefined
    && policy.hard_limit_minor !== undefined
    && policy.require_approval_above_minor > policy.hard_limit_minor
  ) {
    issues.push(issue('INVERTED_LIMITS', 'require_approval_above_minor', 'Approval threshold cannot exceed hard limit.'));
  }

  if (options.verifyHash) {
    const expectedHash = computeHnpPaymentApprovalPolicyHash({
      role: policy.role,
      currency: policy.currency,
      auto_approve_up_to_minor: policy.auto_approve_up_to_minor,
      require_approval_above_minor: policy.require_approval_above_minor,
      hard_limit_minor: policy.hard_limit_minor,
      escrow_required: policy.escrow_required,
      refund_path_required: policy.refund_path_required,
      created_at_ms: policy.created_at_ms,
    });
    if (policy.policy_hash !== expectedHash) {
      issues.push(issue('HASH_MISMATCH', 'policy_hash', 'Payment approval policy hash does not match policy contents.'));
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, warnings: [] };
}

function issue(
  code: HnpPaymentApprovalPolicyIssue['code'],
  field: string,
  message: string,
): HnpPaymentApprovalPolicyIssue {
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
