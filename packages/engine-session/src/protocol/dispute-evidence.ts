import { createHash } from 'node:crypto';
import type { HnpMoney } from './core.js';

export const HNP_DISPUTE_EVIDENCE_KINDS = [
  'condition_at_listing',
  'condition_at_arrival',
  'inspection_checklist',
  'carrier_tracking',
  'message_transcript',
  'payment_record',
  'return_label',
] as const;

export type HnpDisputeEvidenceKind = (typeof HNP_DISPUTE_EVIDENCE_KINDS)[number];

export type HnpDisputeReason =
  | 'item_not_as_described'
  | 'damaged_in_shipping'
  | 'missing_accessory'
  | 'wrong_item'
  | 'non_delivery'
  | 'payment_issue'
  | 'return_dispute'
  | 'other';

export type HnpDisputeRequestedResolution =
  | 'full_refund'
  | 'partial_refund'
  | 'return_for_refund'
  | 'replacement'
  | 'release_payment'
  | 'no_action';

export interface HnpDisputeEvidenceItem {
  evidence_id: string;
  kind: HnpDisputeEvidenceKind;
  uri?: string;
  sha256?: string;
  submitted_by_agent_id?: string;
  submitted_at_ms: number;
  metadata?: Record<string, unknown>;
}

export interface HnpInspectionFinding {
  finding_id: string;
  issue_id: string;
  expected: unknown;
  observed: unknown;
  source_evidence_ids: string[];
  severity?: 'low' | 'medium' | 'high';
}

export interface HnpDisputeEvidencePacket {
  packet_id: string;
  agreement_id: string;
  agreement_hash: string;
  reason: HnpDisputeReason;
  requested_resolution: HnpDisputeRequestedResolution;
  requested_adjustment?: HnpMoney;
  evidence: HnpDisputeEvidenceItem[];
  findings: HnpInspectionFinding[];
  created_at_ms: number;
  packet_hash: string;
}

export interface CreateHnpDisputeEvidencePacketInput {
  agreement_id: string;
  agreement_hash: string;
  reason: HnpDisputeReason;
  requested_resolution: HnpDisputeRequestedResolution;
  requested_adjustment?: HnpMoney;
  evidence?: HnpDisputeEvidenceItem[];
  findings?: HnpInspectionFinding[];
  created_at_ms: number;
}

export interface HnpDisputeEvidencePacketIssue {
  code:
    | 'MISSING_AGREEMENT'
    | 'INVALID_AGREEMENT_HASH'
    | 'EMPTY_EVIDENCE'
    | 'EMPTY_EVIDENCE_ID'
    | 'DUPLICATE_EVIDENCE_ID'
    | 'UNSUPPORTED_EVIDENCE_KIND'
    | 'INVALID_SHA256'
    | 'INVALID_SUBMITTED_AT'
    | 'EMPTY_FINDING_ID'
    | 'EMPTY_ISSUE_ID'
    | 'EMPTY_FINDING_SOURCES'
    | 'UNKNOWN_FINDING_SOURCE'
    | 'INVALID_ADJUSTMENT'
    | 'HASH_MISMATCH';
  field: string;
  message: string;
}

export type HnpDisputeEvidencePacketValidationResult =
  | { ok: true; warnings: HnpDisputeEvidencePacketIssue[] }
  | { ok: false; issues: HnpDisputeEvidencePacketIssue[] };

export function createHnpDisputeEvidencePacket(
  input: CreateHnpDisputeEvidencePacketInput,
): HnpDisputeEvidencePacket {
  const base = {
    agreement_id: input.agreement_id,
    agreement_hash: input.agreement_hash,
    reason: input.reason,
    requested_resolution: input.requested_resolution,
    requested_adjustment: input.requested_adjustment,
    evidence: input.evidence ?? [],
    findings: input.findings ?? [],
    created_at_ms: input.created_at_ms,
  };
  const packetHash = computeHnpDisputeEvidencePacketHash(base);
  return {
    packet_id: `dep_${packetHash.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    ...base,
    packet_hash: packetHash,
  };
}

export function computeHnpDisputeEvidencePacketHash(
  value: Omit<HnpDisputeEvidencePacket, 'packet_id' | 'packet_hash'>,
): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function validateHnpDisputeEvidencePacket(
  packet: HnpDisputeEvidencePacket,
  options: { verifyHash?: boolean } = {},
): HnpDisputeEvidencePacketValidationResult {
  const issues: HnpDisputeEvidencePacketIssue[] = [];

  if (!packet.agreement_id.trim()) {
    issues.push(issue('MISSING_AGREEMENT', 'agreement_id', 'Dispute packet must reference an agreement id.'));
  }

  if (!/^sha256:[a-f0-9]{64}$/.test(packet.agreement_hash)) {
    issues.push(issue('INVALID_AGREEMENT_HASH', 'agreement_hash', 'Dispute packet must reference a valid agreement hash.'));
  }

  if (packet.evidence.length === 0) {
    issues.push(issue('EMPTY_EVIDENCE', 'evidence', 'Dispute packet must include at least one evidence item.'));
  }

  if (packet.requested_adjustment) {
    if (!Number.isInteger(packet.requested_adjustment.units_minor) || packet.requested_adjustment.units_minor < 0) {
      issues.push(issue('INVALID_ADJUSTMENT', 'requested_adjustment.units_minor', 'Requested adjustment must be a non-negative integer minor-unit value.'));
    }
  }

  const evidenceIds = new Set<string>();
  for (const item of packet.evidence) {
    if (!item.evidence_id.trim()) {
      issues.push(issue('EMPTY_EVIDENCE_ID', 'evidence.evidence_id', 'Evidence id cannot be empty.'));
      continue;
    }

    if (evidenceIds.has(item.evidence_id)) {
      issues.push(issue('DUPLICATE_EVIDENCE_ID', 'evidence.evidence_id', `Duplicate evidence id: ${item.evidence_id}`));
    }
    evidenceIds.add(item.evidence_id);

    if (!isSupportedDisputeEvidenceKind(item.kind)) {
      issues.push(issue('UNSUPPORTED_EVIDENCE_KIND', 'evidence.kind', `Unsupported evidence kind: ${item.kind}`));
    }

    if (item.sha256 && !/^sha256:[a-f0-9]{64}$/.test(item.sha256)) {
      issues.push(issue('INVALID_SHA256', 'evidence.sha256', `Invalid sha256 digest for ${item.evidence_id}.`));
    }

    if (!Number.isFinite(item.submitted_at_ms) || item.submitted_at_ms <= 0) {
      issues.push(issue('INVALID_SUBMITTED_AT', 'evidence.submitted_at_ms', `Invalid submitted_at_ms for ${item.evidence_id}.`));
    }
  }

  for (const finding of packet.findings) {
    if (!finding.finding_id.trim()) {
      issues.push(issue('EMPTY_FINDING_ID', 'findings.finding_id', 'Finding id cannot be empty.'));
    }

    if (!finding.issue_id.trim()) {
      issues.push(issue('EMPTY_ISSUE_ID', 'findings.issue_id', 'Finding issue id cannot be empty.'));
    }

    if (finding.source_evidence_ids.length === 0) {
      issues.push(issue('EMPTY_FINDING_SOURCES', 'findings.source_evidence_ids', `Finding ${finding.finding_id} must cite at least one evidence source.`));
    }

    for (const sourceEvidenceId of finding.source_evidence_ids) {
      if (!evidenceIds.has(sourceEvidenceId)) {
        issues.push(issue('UNKNOWN_FINDING_SOURCE', 'findings.source_evidence_ids', `Unknown finding source: ${sourceEvidenceId}`));
      }
    }
  }

  if (options.verifyHash) {
    const expectedHash = computeHnpDisputeEvidencePacketHash({
      agreement_id: packet.agreement_id,
      agreement_hash: packet.agreement_hash,
      reason: packet.reason,
      requested_resolution: packet.requested_resolution,
      requested_adjustment: packet.requested_adjustment,
      evidence: packet.evidence,
      findings: packet.findings,
      created_at_ms: packet.created_at_ms,
    });
    if (packet.packet_hash !== expectedHash) {
      issues.push(issue('HASH_MISMATCH', 'packet_hash', 'Dispute evidence packet hash does not match packet contents.'));
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, warnings: [] };
}

function isSupportedDisputeEvidenceKind(kind: string): kind is HnpDisputeEvidenceKind {
  return (HNP_DISPUTE_EVIDENCE_KINDS as readonly string[]).includes(kind);
}

function issue(
  code: HnpDisputeEvidencePacketIssue['code'],
  field: string,
  message: string,
): HnpDisputeEvidencePacketIssue {
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
