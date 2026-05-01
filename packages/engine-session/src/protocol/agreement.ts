import { createHash } from 'node:crypto';
import type { HnpIssueValue, HnpMoney } from './core.js';

export interface HnpAgreementParty {
  agent_id: string;
  role: 'BUYER' | 'SELLER' | 'MEDIATOR';
}

export interface HnpAgreementObject {
  agreement_id: string;
  session_id: string;
  accepted_message_id: string;
  accepted_proposal_id: string;
  accepted_proposal_hash?: string;
  agreed_price?: HnpMoney;
  accepted_issues: HnpIssueValue[];
  listing_evidence_bundle_hash?: string;
  payment_approval_policy_hash?: string;
  shipping_terms_hash?: string;
  parties: HnpAgreementParty[];
  settlement_preconditions: string[];
  created_at_ms: number;
  agreement_hash: string;
}

export interface HnpAgreementIssue {
  code:
    | 'MISSING_SESSION'
    | 'MISSING_ACCEPTED_MESSAGE'
    | 'MISSING_ACCEPTED_PROPOSAL'
    | 'INVALID_REFERENCE_HASH'
    | 'INVALID_PRICE'
    | 'EMPTY_PARTY_AGENT'
    | 'DUPLICATE_PARTY'
    | 'EMPTY_PRECONDITION'
    | 'INVALID_CREATED_AT'
    | 'HASH_MISMATCH';
  field: string;
  message: string;
}

export type HnpAgreementValidationResult =
  | { ok: true; warnings: HnpAgreementIssue[] }
  | { ok: false; issues: HnpAgreementIssue[] };

export interface CreateHnpAgreementInput {
  session_id: string;
  accepted_message_id: string;
  accepted_proposal_id: string;
  accepted_proposal_hash?: string;
  agreed_price?: HnpMoney;
  accepted_issues?: HnpIssueValue[];
  listing_evidence_bundle_hash?: string;
  payment_approval_policy_hash?: string;
  shipping_terms_hash?: string;
  parties?: HnpAgreementParty[];
  settlement_preconditions?: string[];
  created_at_ms: number;
}

export function createHnpAgreementObject(input: CreateHnpAgreementInput): HnpAgreementObject {
  const base = {
    session_id: input.session_id,
    accepted_message_id: input.accepted_message_id,
    accepted_proposal_id: input.accepted_proposal_id,
    accepted_proposal_hash: input.accepted_proposal_hash,
    agreed_price: input.agreed_price,
    accepted_issues: input.accepted_issues ?? [],
    listing_evidence_bundle_hash: input.listing_evidence_bundle_hash,
    payment_approval_policy_hash: input.payment_approval_policy_hash,
    shipping_terms_hash: input.shipping_terms_hash,
    parties: input.parties ?? [],
    settlement_preconditions: input.settlement_preconditions ?? [],
    created_at_ms: input.created_at_ms,
  };
  const agreementHash = hashAgreementBase(base);
  return {
    agreement_id: `agr_${agreementHash.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    ...base,
    agreement_hash: agreementHash,
  };
}

export function computeHnpAgreementHash(
  value: Omit<HnpAgreementObject, 'agreement_id' | 'agreement_hash'>,
): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function validateHnpAgreementObject(
  agreement: HnpAgreementObject,
  options: { verifyHash?: boolean } = {},
): HnpAgreementValidationResult {
  const issues: HnpAgreementIssue[] = [];

  if (!agreement.session_id.trim()) {
    issues.push(issue('MISSING_SESSION', 'session_id', 'Agreement must reference a session.'));
  }

  if (!agreement.accepted_message_id.trim()) {
    issues.push(issue('MISSING_ACCEPTED_MESSAGE', 'accepted_message_id', 'Agreement must reference the accepted message.'));
  }

  if (!agreement.accepted_proposal_id.trim()) {
    issues.push(issue('MISSING_ACCEPTED_PROPOSAL', 'accepted_proposal_id', 'Agreement must reference the accepted proposal.'));
  }

  validateOptionalHash(issues, 'accepted_proposal_hash', agreement.accepted_proposal_hash);
  validateOptionalHash(issues, 'listing_evidence_bundle_hash', agreement.listing_evidence_bundle_hash);
  validateOptionalHash(issues, 'payment_approval_policy_hash', agreement.payment_approval_policy_hash);
  validateOptionalHash(issues, 'shipping_terms_hash', agreement.shipping_terms_hash);

  if (
    agreement.agreed_price
    && (!Number.isInteger(agreement.agreed_price.units_minor) || agreement.agreed_price.units_minor < 0)
  ) {
    issues.push(issue('INVALID_PRICE', 'agreed_price.units_minor', 'Agreed price must be a non-negative integer minor-unit value.'));
  }

  const parties = new Set<string>();
  for (const party of agreement.parties) {
    if (!party.agent_id.trim()) {
      issues.push(issue('EMPTY_PARTY_AGENT', 'parties.agent_id', 'Agreement party agent id cannot be empty.'));
      continue;
    }
    const partyKey = `${party.role}:${party.agent_id}`;
    if (parties.has(partyKey)) {
      issues.push(issue('DUPLICATE_PARTY', 'parties', `Duplicate agreement party: ${partyKey}`));
    }
    parties.add(partyKey);
  }

  if (agreement.settlement_preconditions.some((precondition) => !precondition.trim())) {
    issues.push(issue('EMPTY_PRECONDITION', 'settlement_preconditions', 'Settlement preconditions cannot contain empty values.'));
  }

  if (!Number.isFinite(agreement.created_at_ms) || agreement.created_at_ms <= 0) {
    issues.push(issue('INVALID_CREATED_AT', 'created_at_ms', 'Agreement time must be a positive timestamp.'));
  }

  if (options.verifyHash) {
    const expectedHash = computeHnpAgreementHash({
      session_id: agreement.session_id,
      accepted_message_id: agreement.accepted_message_id,
      accepted_proposal_id: agreement.accepted_proposal_id,
      accepted_proposal_hash: agreement.accepted_proposal_hash,
      agreed_price: agreement.agreed_price,
      accepted_issues: agreement.accepted_issues,
      listing_evidence_bundle_hash: agreement.listing_evidence_bundle_hash,
      payment_approval_policy_hash: agreement.payment_approval_policy_hash,
      shipping_terms_hash: agreement.shipping_terms_hash,
      parties: agreement.parties,
      settlement_preconditions: agreement.settlement_preconditions,
      created_at_ms: agreement.created_at_ms,
    });
    if (agreement.agreement_hash !== expectedHash) {
      issues.push(issue('HASH_MISMATCH', 'agreement_hash', 'Agreement hash does not match agreement contents.'));
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, warnings: [] };
}

function hashAgreementBase(value: Omit<HnpAgreementObject, 'agreement_id' | 'agreement_hash'>): string {
  return computeHnpAgreementHash(value);
}

function validateOptionalHash(
  issues: HnpAgreementIssue[],
  field: string,
  value: string | undefined,
): void {
  if (value !== undefined && !/^sha256:[a-f0-9]{64}$/.test(value)) {
    issues.push(issue('INVALID_REFERENCE_HASH', field, `${field} must be a valid sha256 reference.`));
  }
}

function issue(code: HnpAgreementIssue['code'], field: string, message: string): HnpAgreementIssue {
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
