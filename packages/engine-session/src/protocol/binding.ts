import { createHash } from 'node:crypto';
import type { HnpIssueValue, HnpProposalPayload } from './core.js';

export interface HnpProposalBinding {
  proposal_id: string;
  issues: HnpIssueValue[];
  total_price: HnpProposalPayload['total_price'];
  valid_until?: string;
  settlement_preconditions?: string[];
}

export function computeHnpProposalHash(proposal: HnpProposalBinding): string {
  const canonical = canonicalJson({
    proposal_id: proposal.proposal_id,
    issues: normalizeIssues(proposal.issues),
    total_price: proposal.total_price,
    valid_until: proposal.valid_until,
    settlement_preconditions: normalizeSettlementPreconditions(proposal.settlement_preconditions),
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

export function proposalMatchesAcceptedHash(
  proposal: Pick<HnpProposalPayload, 'proposal_id' | 'issues' | 'total_price' | 'valid_until' | 'settlement_preconditions'>,
  acceptedProposalHash?: string,
): boolean {
  if (!acceptedProposalHash) return true;
  return computeHnpProposalHash(proposal) === acceptedProposalHash;
}

function normalizeIssues(issues: HnpIssueValue[]): HnpIssueValue[] {
  return [...issues].sort((a, b) => a.issue_id.localeCompare(b.issue_id));
}

function normalizeSettlementPreconditions(preconditions?: string[]): string[] | undefined {
  if (!preconditions) return undefined;
  return [...new Set(preconditions)].sort((a, b) => a.localeCompare(b));
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
