import { createHash } from 'node:crypto';

export const HNP_LISTING_EVIDENCE_KINDS = [
  'image',
  'video',
  'document',
  'serial_check',
  'imei_check',
  'condition_report',
  'market_comp',
  'user_attestation',
] as const;

export type HnpListingEvidenceKind = (typeof HNP_LISTING_EVIDENCE_KINDS)[number];

export interface HnpProductIdentitySubject {
  canonical_product_id?: string;
  family?: string;
  model?: string;
  generation?: string;
  variant?: Record<string, string>;
  identifiers?: Record<string, string>;
}

export interface HnpListingEvidenceItem {
  evidence_id: string;
  kind: HnpListingEvidenceKind;
  uri?: string;
  sha256?: string;
  content_type?: string;
  submitted_by_agent_id?: string;
  created_at_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface HnpListingEvidenceClaim {
  claim_id: string;
  issue_id: string;
  value: unknown;
  confidence?: number;
  source_evidence_ids: string[];
}

export interface HnpListingEvidenceBundle {
  bundle_id: string;
  subject: HnpProductIdentitySubject;
  evidence: HnpListingEvidenceItem[];
  claims: HnpListingEvidenceClaim[];
  created_at_ms: number;
  bundle_hash: string;
}

export interface CreateHnpListingEvidenceBundleInput {
  subject: HnpProductIdentitySubject;
  evidence?: HnpListingEvidenceItem[];
  claims?: HnpListingEvidenceClaim[];
  created_at_ms: number;
}

export interface HnpListingEvidenceValidationIssue {
  code:
    | 'MISSING_SUBJECT'
    | 'EMPTY_EVIDENCE'
    | 'EMPTY_EVIDENCE_ID'
    | 'EMPTY_CLAIM_ID'
    | 'EMPTY_ISSUE_ID'
    | 'EMPTY_CLAIM_SOURCES'
    | 'DUPLICATE_EVIDENCE_ID'
    | 'UNSUPPORTED_EVIDENCE_KIND'
    | 'INVALID_SHA256'
    | 'INVALID_CONFIDENCE'
    | 'UNKNOWN_CLAIM_SOURCE'
    | 'HASH_MISMATCH';
  field: string;
  message: string;
}

export type HnpListingEvidenceValidationResult =
  | { ok: true; warnings: HnpListingEvidenceValidationIssue[] }
  | { ok: false; issues: HnpListingEvidenceValidationIssue[] };

export function createHnpListingEvidenceBundle(
  input: CreateHnpListingEvidenceBundleInput,
): HnpListingEvidenceBundle {
  const base = {
    subject: input.subject,
    evidence: input.evidence ?? [],
    claims: input.claims ?? [],
    created_at_ms: input.created_at_ms,
  };
  const bundleHash = computeHnpListingEvidenceBundleHash(base);
  return {
    bundle_id: `leb_${bundleHash.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    ...base,
    bundle_hash: bundleHash,
  };
}

export function computeHnpListingEvidenceBundleHash(
  value: Omit<HnpListingEvidenceBundle, 'bundle_id' | 'bundle_hash'>,
): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function validateHnpListingEvidenceBundle(
  bundle: HnpListingEvidenceBundle,
  options: { verifyHash?: boolean } = {},
): HnpListingEvidenceValidationResult {
  const issues: HnpListingEvidenceValidationIssue[] = [];

  if (!hasSubjectIdentity(bundle.subject)) {
    issues.push(issue('MISSING_SUBJECT', 'subject', 'Evidence bundle must identify the listing subject.'));
  }

  if (bundle.evidence.length === 0) {
    issues.push(issue('EMPTY_EVIDENCE', 'evidence', 'Evidence bundle must include at least one evidence item.'));
  }

  const evidenceIds = new Set<string>();
  for (const item of bundle.evidence) {
    if (!item.evidence_id.trim()) {
      issues.push(issue('EMPTY_EVIDENCE_ID', 'evidence.evidence_id', 'Evidence id cannot be empty.'));
      continue;
    }

    if (evidenceIds.has(item.evidence_id)) {
      issues.push(issue('DUPLICATE_EVIDENCE_ID', 'evidence.evidence_id', `Duplicate evidence id: ${item.evidence_id}`));
    }
    evidenceIds.add(item.evidence_id);

    if (!isSupportedListingEvidenceKind(item.kind)) {
      issues.push(issue('UNSUPPORTED_EVIDENCE_KIND', 'evidence.kind', `Unsupported evidence kind: ${item.kind}`));
    }

    if (item.sha256 && !/^sha256:[a-f0-9]{64}$/.test(item.sha256)) {
      issues.push(issue('INVALID_SHA256', 'evidence.sha256', `Invalid sha256 digest for ${item.evidence_id}.`));
    }
  }

  for (const claim of bundle.claims) {
    if (!claim.claim_id.trim()) {
      issues.push(issue('EMPTY_CLAIM_ID', 'claims.claim_id', 'Claim id cannot be empty.'));
    }

    if (!claim.issue_id.trim()) {
      issues.push(issue('EMPTY_ISSUE_ID', 'claims.issue_id', 'Claim issue id cannot be empty.'));
    }

    if (claim.source_evidence_ids.length === 0) {
      issues.push(issue('EMPTY_CLAIM_SOURCES', 'claims.source_evidence_ids', `Claim ${claim.claim_id} must cite at least one evidence source.`));
    }

    if (claim.confidence !== undefined && (claim.confidence < 0 || claim.confidence > 1)) {
      issues.push(issue('INVALID_CONFIDENCE', 'claims.confidence', `Confidence must be between 0 and 1 for ${claim.claim_id}.`));
    }

    for (const sourceEvidenceId of claim.source_evidence_ids) {
      if (!evidenceIds.has(sourceEvidenceId)) {
        issues.push(issue('UNKNOWN_CLAIM_SOURCE', 'claims.source_evidence_ids', `Unknown claim source: ${sourceEvidenceId}`));
      }
    }
  }

  if (options.verifyHash) {
    const expectedHash = computeHnpListingEvidenceBundleHash({
      subject: bundle.subject,
      evidence: bundle.evidence,
      claims: bundle.claims,
      created_at_ms: bundle.created_at_ms,
    });
    if (bundle.bundle_hash !== expectedHash) {
      issues.push(issue('HASH_MISMATCH', 'bundle_hash', 'Evidence bundle hash does not match bundle contents.'));
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, warnings: [] };
}

function isSupportedListingEvidenceKind(kind: string): kind is HnpListingEvidenceKind {
  return (HNP_LISTING_EVIDENCE_KINDS as readonly string[]).includes(kind);
}

function hasSubjectIdentity(subject: HnpProductIdentitySubject | undefined): boolean {
  if (!subject) return false;
  if (hasText(subject.canonical_product_id)) return true;
  if (hasText(subject.family)) return true;
  if (hasText(subject.model)) return true;
  if (hasText(subject.generation)) return true;
  if (hasRecordValue(subject.variant)) return true;
  if (hasRecordValue(subject.identifiers)) return true;
  return false;
}

function hasRecordValue(record: Record<string, string> | undefined): boolean {
  return Boolean(record && Object.values(record).some(hasText));
}

function hasText(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

function issue(
  code: HnpListingEvidenceValidationIssue['code'],
  field: string,
  message: string,
): HnpListingEvidenceValidationIssue {
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
