import { createHash } from 'node:crypto';

export type HnpTransactionHandoffStatus =
  | 'ready_for_settlement'
  | 'needs_human_approval'
  | 'blocked'
  | 'settled'
  | 'disputed';

export type HnpTransactionNextAction =
  | 'prepare_settlement'
  | 'request_human_approval'
  | 'stop_transaction'
  | 'record_settlement_complete'
  | 'open_dispute_review';

export interface HnpTransactionHandoff {
  handoff_id: string;
  agreement_hash: string;
  status: HnpTransactionHandoffStatus;
  next_action: HnpTransactionNextAction;
  listing_evidence_bundle_hash?: string;
  payment_approval_policy_hash?: string;
  shipping_terms_hash?: string;
  dispute_evidence_packet_hashes: string[];
  trust_event_hashes: string[];
  required_human_approvals: string[];
  blocking_reasons: string[];
  created_at_ms: number;
  handoff_hash: string;
}

export interface CreateHnpTransactionHandoffInput {
  agreement_hash: string;
  status: HnpTransactionHandoffStatus;
  next_action?: HnpTransactionNextAction;
  listing_evidence_bundle_hash?: string;
  payment_approval_policy_hash?: string;
  shipping_terms_hash?: string;
  dispute_evidence_packet_hashes?: string[];
  trust_event_hashes?: string[];
  required_human_approvals?: string[];
  blocking_reasons?: string[];
  created_at_ms: number;
}

export interface CreateHnpTransactionHandoffFromSignalsInput {
  agreement_hash: string;
  payment_decision?: DeriveHnpTransactionHandoffStatusInput['payment_decision'];
  payment_reasons?: string[];
  settlement_completed?: boolean;
  listing_evidence_bundle_hash?: string;
  payment_approval_policy_hash?: string;
  shipping_terms_hash?: string;
  dispute_evidence_packet_hashes?: string[];
  trust_event_hashes?: string[];
  created_at_ms: number;
}

export interface HnpTransactionHandoffIssue {
  code:
    | 'INVALID_AGREEMENT_HASH'
    | 'INVALID_REFERENCE_HASH'
    | 'DUPLICATE_REFERENCE_HASH'
    | 'MISSING_APPROVAL_REASON'
    | 'EMPTY_APPROVAL_REASON'
    | 'DUPLICATE_APPROVAL_REASON'
    | 'MISSING_BLOCK_REASON'
    | 'EMPTY_BLOCK_REASON'
    | 'DUPLICATE_BLOCK_REASON'
    | 'INCONSISTENT_STATUS'
    | 'INVALID_NEXT_ACTION'
    | 'INVALID_CREATED_AT'
    | 'HASH_MISMATCH';
  field: string;
  message: string;
}

export type HnpTransactionHandoffValidationResult =
  | { ok: true; warnings: HnpTransactionHandoffIssue[] }
  | { ok: false; issues: HnpTransactionHandoffIssue[] };

export interface HnpTransactionHandoffTransitionIssue {
  code:
    | 'AGREEMENT_HASH_CHANGED'
    | 'NON_MONOTONIC_TIME'
    | 'INVALID_STATUS_TRANSITION';
  field: string;
  message: string;
}

export type HnpTransactionHandoffTransitionResult =
  | { ok: true; warnings: HnpTransactionHandoffTransitionIssue[] }
  | { ok: false; issues: HnpTransactionHandoffTransitionIssue[] };

export interface HnpTransactionHandoffChainIssue {
  code: 'EMPTY_CHAIN' | 'INVALID_HANDOFF' | 'INVALID_TRANSITION';
  index: number;
  field: string;
  message: string;
  cause_code?: HnpTransactionHandoffIssue['code'] | HnpTransactionHandoffTransitionIssue['code'];
}

export type HnpTransactionHandoffChainResult =
  | { ok: true; warnings: HnpTransactionHandoffChainIssue[] }
  | { ok: false; issues: HnpTransactionHandoffChainIssue[] };

export interface HnpTransactionHandoffChainSummary {
  agreement_hash: string;
  handoff_count: number;
  first_status: HnpTransactionHandoffStatus;
  current_status: HnpTransactionHandoffStatus;
  current_next_action: HnpTransactionNextAction;
  started_at_ms: number;
  updated_at_ms: number;
  terminal: boolean;
  handoff_hashes: string[];
  chain_hash: string;
}

export interface DeriveHnpTransactionHandoffStatusInput {
  payment_decision?: 'AUTO_APPROVE' | 'HUMAN_APPROVAL_REQUIRED' | 'BLOCKED';
  dispute_evidence_packet_hashes?: string[];
  settlement_completed?: boolean;
}

export function createHnpTransactionHandoff(
  input: CreateHnpTransactionHandoffInput,
): HnpTransactionHandoff {
  const base = {
    agreement_hash: input.agreement_hash,
    status: input.status,
    next_action: input.next_action ?? getHnpTransactionNextAction(input.status),
    listing_evidence_bundle_hash: input.listing_evidence_bundle_hash,
    payment_approval_policy_hash: input.payment_approval_policy_hash,
    shipping_terms_hash: input.shipping_terms_hash,
    dispute_evidence_packet_hashes: input.dispute_evidence_packet_hashes ?? [],
    trust_event_hashes: input.trust_event_hashes ?? [],
    required_human_approvals: input.required_human_approvals ?? [],
    blocking_reasons: input.blocking_reasons ?? [],
    created_at_ms: input.created_at_ms,
  };
  const handoffHash = computeHnpTransactionHandoffHash(base);
  return {
    handoff_id: `handoff_${handoffHash.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    ...base,
    handoff_hash: handoffHash,
  };
}

export function createHnpTransactionHandoffFromSignals(
  input: CreateHnpTransactionHandoffFromSignalsInput,
): HnpTransactionHandoff {
  const status = deriveHnpTransactionHandoffStatus({
    payment_decision: input.payment_decision,
    dispute_evidence_packet_hashes: input.dispute_evidence_packet_hashes,
    settlement_completed: input.settlement_completed,
  });
  const paymentReasons = input.payment_reasons?.filter((reason) => reason.trim()) ?? [];

  return createHnpTransactionHandoff({
    agreement_hash: input.agreement_hash,
    status,
    listing_evidence_bundle_hash: input.listing_evidence_bundle_hash,
    payment_approval_policy_hash: input.payment_approval_policy_hash,
    shipping_terms_hash: input.shipping_terms_hash,
    dispute_evidence_packet_hashes: input.dispute_evidence_packet_hashes,
    trust_event_hashes: input.trust_event_hashes,
    required_human_approvals: status === 'needs_human_approval'
      ? uniqueReasons(paymentReasons.length > 0 ? paymentReasons : ['payment_approval_required'])
      : [],
    blocking_reasons: status === 'blocked'
      ? uniqueReasons(paymentReasons.length > 0 ? paymentReasons : ['payment_blocked'])
      : [],
    created_at_ms: input.created_at_ms,
  });
}

export function computeHnpTransactionHandoffHash(
  value: Omit<HnpTransactionHandoff, 'handoff_id' | 'handoff_hash'>,
): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function validateHnpTransactionHandoff(
  handoff: HnpTransactionHandoff,
  options: { verifyHash?: boolean } = {},
): HnpTransactionHandoffValidationResult {
  const issues: HnpTransactionHandoffIssue[] = [];

  if (!isSha256(handoff.agreement_hash)) {
    issues.push(issue('INVALID_AGREEMENT_HASH', 'agreement_hash', 'Transaction handoff must reference a valid agreement hash.'));
  }

  validateOptionalHash(issues, 'listing_evidence_bundle_hash', handoff.listing_evidence_bundle_hash);
  validateOptionalHash(issues, 'payment_approval_policy_hash', handoff.payment_approval_policy_hash);
  validateOptionalHash(issues, 'shipping_terms_hash', handoff.shipping_terms_hash);
  validateHashList(issues, 'dispute_evidence_packet_hashes', handoff.dispute_evidence_packet_hashes);
  validateHashList(issues, 'trust_event_hashes', handoff.trust_event_hashes);

  if (handoff.next_action !== getHnpTransactionNextAction(handoff.status)) {
    issues.push(issue('INVALID_NEXT_ACTION', 'next_action', 'Transaction handoff next_action must match status.'));
  }

  if (!Number.isFinite(handoff.created_at_ms) || handoff.created_at_ms <= 0) {
    issues.push(issue('INVALID_CREATED_AT', 'created_at_ms', 'Transaction handoff time must be a positive timestamp.'));
  }

  if (handoff.status === 'needs_human_approval' && handoff.required_human_approvals.length === 0) {
    issues.push(issue('MISSING_APPROVAL_REASON', 'required_human_approvals', 'Human approval status must explain what approval is required.'));
  }
  validateReasonList(issues, 'required_human_approvals', handoff.required_human_approvals, {
    emptyCode: 'EMPTY_APPROVAL_REASON',
    duplicateCode: 'DUPLICATE_APPROVAL_REASON',
  });

  if (handoff.status === 'blocked' && handoff.blocking_reasons.length === 0) {
    issues.push(issue('MISSING_BLOCK_REASON', 'blocking_reasons', 'Blocked status must explain why the transaction is blocked.'));
  }
  validateReasonList(issues, 'blocking_reasons', handoff.blocking_reasons, {
    emptyCode: 'EMPTY_BLOCK_REASON',
    duplicateCode: 'DUPLICATE_BLOCK_REASON',
  });

  if (handoff.status !== 'disputed' && handoff.dispute_evidence_packet_hashes.length > 0) {
    issues.push(issue('INCONSISTENT_STATUS', 'status', 'Dispute evidence can only be attached when status is disputed.'));
  }

  if (options.verifyHash) {
    const expectedHash = computeHnpTransactionHandoffHash({
      agreement_hash: handoff.agreement_hash,
      status: handoff.status,
      next_action: handoff.next_action,
      listing_evidence_bundle_hash: handoff.listing_evidence_bundle_hash,
      payment_approval_policy_hash: handoff.payment_approval_policy_hash,
      shipping_terms_hash: handoff.shipping_terms_hash,
      dispute_evidence_packet_hashes: handoff.dispute_evidence_packet_hashes,
      trust_event_hashes: handoff.trust_event_hashes,
      required_human_approvals: handoff.required_human_approvals,
      blocking_reasons: handoff.blocking_reasons,
      created_at_ms: handoff.created_at_ms,
    });
    if (handoff.handoff_hash !== expectedHash) {
      issues.push(issue('HASH_MISMATCH', 'handoff_hash', 'Transaction handoff hash does not match handoff contents.'));
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, warnings: [] };
}

export function deriveHnpTransactionHandoffStatus(
  input: DeriveHnpTransactionHandoffStatusInput,
): HnpTransactionHandoffStatus {
  if (input.dispute_evidence_packet_hashes && input.dispute_evidence_packet_hashes.length > 0) {
    return 'disputed';
  }
  if (input.settlement_completed) return 'settled';
  if (input.payment_decision === 'BLOCKED') return 'blocked';
  if (input.payment_decision === 'HUMAN_APPROVAL_REQUIRED') return 'needs_human_approval';
  return 'ready_for_settlement';
}

export function getHnpTransactionNextAction(
  status: HnpTransactionHandoffStatus,
): HnpTransactionNextAction {
  switch (status) {
    case 'ready_for_settlement':
      return 'prepare_settlement';
    case 'needs_human_approval':
      return 'request_human_approval';
    case 'blocked':
      return 'stop_transaction';
    case 'settled':
      return 'record_settlement_complete';
    case 'disputed':
      return 'open_dispute_review';
  }
}

export function validateHnpTransactionHandoffTransition(
  previous: HnpTransactionHandoff,
  next: HnpTransactionHandoff,
): HnpTransactionHandoffTransitionResult {
  const issues: HnpTransactionHandoffTransitionIssue[] = [];

  if (previous.agreement_hash !== next.agreement_hash) {
    issues.push(transitionIssue(
      'AGREEMENT_HASH_CHANGED',
      'agreement_hash',
      'Transaction handoff transition must stay bound to the same agreement hash.',
    ));
  }

  if (next.created_at_ms < previous.created_at_ms) {
    issues.push(transitionIssue(
      'NON_MONOTONIC_TIME',
      'created_at_ms',
      'Transaction handoff transition cannot move backward in time.',
    ));
  }

  if (!allowedNextStatuses(previous.status).includes(next.status)) {
    issues.push(transitionIssue(
      'INVALID_STATUS_TRANSITION',
      'status',
      `Cannot transition from ${previous.status} to ${next.status}.`,
    ));
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, warnings: [] };
}

export function validateHnpTransactionHandoffChain(
  handoffs: HnpTransactionHandoff[],
  options: { verifyHash?: boolean } = {},
): HnpTransactionHandoffChainResult {
  const issues: HnpTransactionHandoffChainIssue[] = [];

  if (handoffs.length === 0) {
    return {
      ok: false,
      issues: [{
        code: 'EMPTY_CHAIN',
        index: -1,
        field: 'handoffs',
        message: 'Transaction handoff chain must include at least one handoff.',
      }],
    };
  }

  for (let index = 0; index < handoffs.length; index += 1) {
    const handoffResult = validateHnpTransactionHandoff(handoffs[index], options);
    if (!handoffResult.ok) {
      for (const handoffIssue of handoffResult.issues) {
        issues.push({
          code: 'INVALID_HANDOFF',
          index,
          field: handoffIssue.field,
          message: handoffIssue.message,
          cause_code: handoffIssue.code,
        });
      }
    }

    if (index === 0) continue;

    const transitionResult = validateHnpTransactionHandoffTransition(handoffs[index - 1], handoffs[index]);
    if (!transitionResult.ok) {
      for (const transitionIssue of transitionResult.issues) {
        issues.push({
          code: 'INVALID_TRANSITION',
          index,
          field: transitionIssue.field,
          message: transitionIssue.message,
          cause_code: transitionIssue.code,
        });
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, warnings: [] };
}

export function summarizeHnpTransactionHandoffChain(
  handoffs: HnpTransactionHandoff[],
  options: { verifyHash?: boolean } = {},
): HnpTransactionHandoffChainSummary | undefined {
  if (handoffs.length === 0) return undefined;

  const chainResult = validateHnpTransactionHandoffChain(handoffs, options);
  if (!chainResult.ok) return undefined;

  const first = handoffs[0];
  const current = handoffs[handoffs.length - 1];
  const handoffHashes = handoffs.map((handoff) => handoff.handoff_hash);
  const base = {
    agreement_hash: first.agreement_hash,
    handoff_count: handoffs.length,
    first_status: first.status,
    current_status: current.status,
    current_next_action: current.next_action,
    started_at_ms: first.created_at_ms,
    updated_at_ms: current.created_at_ms,
    terminal: isTerminalHandoffStatus(current.status),
    handoff_hashes: handoffHashes,
  };

  return {
    ...base,
    chain_hash: computeHnpTransactionHandoffChainHash(handoffs),
  };
}

export function computeHnpTransactionHandoffChainHash(handoffs: HnpTransactionHandoff[]): string {
  return `sha256:${createHash('sha256').update(canonicalJson(
    handoffs.map((handoff) => ({
      handoff_id: handoff.handoff_id,
      handoff_hash: handoff.handoff_hash,
      status: handoff.status,
      next_action: handoff.next_action,
      created_at_ms: handoff.created_at_ms,
    })),
  )).digest('hex')}`;
}

function validateOptionalHash(
  issues: HnpTransactionHandoffIssue[],
  field: string,
  value: string | undefined,
): void {
  if (value !== undefined && !isSha256(value)) {
    issues.push(issue('INVALID_REFERENCE_HASH', field, `${field} must be a valid sha256 reference.`));
  }
}

function validateHashList(
  issues: HnpTransactionHandoffIssue[],
  field: string,
  values: string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!isSha256(value)) {
      issues.push(issue('INVALID_REFERENCE_HASH', field, `${field} contains an invalid sha256 reference.`));
      continue;
    }
    if (seen.has(value)) {
      issues.push(issue('DUPLICATE_REFERENCE_HASH', field, `${field} contains duplicate hash ${value}.`));
    }
    seen.add(value);
  }
}

function validateReasonList(
  issues: HnpTransactionHandoffIssue[],
  field: string,
  values: string[],
  codes: {
    emptyCode: Extract<HnpTransactionHandoffIssue['code'], 'EMPTY_APPROVAL_REASON' | 'EMPTY_BLOCK_REASON'>;
    duplicateCode: Extract<HnpTransactionHandoffIssue['code'], 'DUPLICATE_APPROVAL_REASON' | 'DUPLICATE_BLOCK_REASON'>;
  },
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      issues.push(issue(codes.emptyCode, field, `${field} cannot contain empty values.`));
      continue;
    }
    if (seen.has(normalized)) {
      issues.push(issue(codes.duplicateCode, field, `${field} contains duplicate value ${normalized}.`));
    }
    seen.add(normalized);
  }
}

function uniqueReasons(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isTerminalHandoffStatus(status: HnpTransactionHandoffStatus): boolean {
  return allowedNextStatuses(status).every((nextStatus) => nextStatus === status);
}

function allowedNextStatuses(status: HnpTransactionHandoffStatus): HnpTransactionHandoffStatus[] {
  switch (status) {
    case 'ready_for_settlement':
      return ['ready_for_settlement', 'needs_human_approval', 'blocked', 'settled', 'disputed'];
    case 'needs_human_approval':
      return ['needs_human_approval', 'ready_for_settlement', 'blocked', 'disputed'];
    case 'blocked':
      return ['blocked'];
    case 'settled':
      return ['settled', 'disputed'];
    case 'disputed':
      return ['disputed', 'settled'];
  }
}

function transitionIssue(
  code: HnpTransactionHandoffTransitionIssue['code'],
  field: string,
  message: string,
): HnpTransactionHandoffTransitionIssue {
  return { code, field, message };
}

function isSha256(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function issue(
  code: HnpTransactionHandoffIssue['code'],
  field: string,
  message: string,
): HnpTransactionHandoffIssue {
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
