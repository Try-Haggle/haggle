import {
  HNP_CORE_CAPABILITY,
  HNP_CORE_REVISIONS,
  type HnpCoreMessageType,
  type HnpEnvelope,
  type HnpErrorCode,
} from './core.js';
import { isSupportedIssueId } from './issue-registry.js';

export interface HnpConformanceOptions {
  nowMs?: number;
  supportedCapabilities?: readonly string[];
  supportedIssueNamespaces?: readonly string[];
  requireSignature?: boolean;
}

export interface HnpConformanceIssue {
  code: HnpErrorCode;
  field: string;
  message: string;
}

export type HnpConformanceResult =
  | { ok: true; warnings: HnpConformanceIssue[] }
  | { ok: false; issues: HnpConformanceIssue[]; warnings: HnpConformanceIssue[] };

const CORE_TYPES = new Set<HnpCoreMessageType>([
  'HELLO',
  'CAPABILITIES',
  'OFFER',
  'COUNTER',
  'ACCEPT',
  'REJECT',
  'ESCALATE',
  'CANCEL',
  'ACK',
  'ERROR',
]);

export function validateHnpEnvelopeConformance(
  envelope: Partial<HnpEnvelope>,
  options: HnpConformanceOptions = {},
): HnpConformanceResult {
  const issues: HnpConformanceIssue[] = [];
  const warnings: HnpConformanceIssue[] = [];
  const nowMs = options.nowMs ?? Date.now();
  const supportedCapabilities = options.supportedCapabilities ?? [HNP_CORE_CAPABILITY];
  const supportedIssueNamespaces = options.supportedIssueNamespaces ?? ['hnp.issue'];

  requireString(envelope.spec_version, 'spec_version', 'UNSUPPORTED_VERSION', issues);
  if (typeof envelope.spec_version === 'string' && !HNP_CORE_REVISIONS.includes(envelope.spec_version as any)) {
    warnings.push(issue('UNSUPPORTED_VERSION', 'spec_version', `Unknown HNP revision: ${envelope.spec_version}`));
  }

  requireString(envelope.capability, 'capability', 'UNSUPPORTED_EXTENSION', issues);
  if (typeof envelope.capability === 'string' && !supportedCapabilities.includes(envelope.capability)) {
    issues.push(issue('UNSUPPORTED_EXTENSION', 'capability', `Unsupported capability: ${envelope.capability}`));
  }

  requireString(envelope.session_id, 'session_id', 'INVALID_PROPOSAL', issues);
  requireString(envelope.message_id, 'message_id', 'INVALID_PROPOSAL', issues);
  requireString(envelope.idempotency_key, 'idempotency_key', 'INVALID_PROPOSAL', issues);
  requireString(envelope.sender_agent_id, 'sender_agent_id', 'INVALID_PROPOSAL', issues);

  if (typeof envelope.sequence !== 'number' || !Number.isInteger(envelope.sequence) || envelope.sequence < 0) {
    issues.push(issue('INVALID_PROPOSAL', 'sequence', 'sequence must be a non-negative integer'));
  }
  if (typeof envelope.sent_at_ms !== 'number' || envelope.sent_at_ms <= 0) {
    issues.push(issue('INVALID_PROPOSAL', 'sent_at_ms', 'sent_at_ms must be a positive epoch ms value'));
  }
  if (typeof envelope.expires_at_ms !== 'number' || envelope.expires_at_ms <= 0) {
    issues.push(issue('INVALID_PROPOSAL', 'expires_at_ms', 'expires_at_ms must be a positive epoch ms value'));
  } else if (envelope.expires_at_ms <= nowMs) {
    issues.push(issue('STALE_MESSAGE', 'expires_at_ms', 'message has expired'));
  }

  if (envelope.sender_role !== 'BUYER' && envelope.sender_role !== 'SELLER' && envelope.sender_role !== 'MEDIATOR') {
    issues.push(issue('INVALID_PROPOSAL', 'sender_role', 'sender_role must be BUYER, SELLER, or MEDIATOR'));
  }
  if (!envelope.type || !CORE_TYPES.has(envelope.type)) {
    issues.push(issue('INVALID_PROPOSAL', 'type', 'type must be a known HNP core message type'));
  }
  if (options.requireSignature && typeof envelope.detached_signature !== 'string') {
    issues.push(issue('SIGNATURE_REQUIRED', 'detached_signature', 'detached JWS signature is required'));
  }

  validatePayload(envelope, supportedIssueNamespaces, issues);

  return issues.length === 0
    ? { ok: true, warnings }
    : { ok: false, issues, warnings };
}

function validatePayload(
  envelope: Partial<HnpEnvelope>,
  supportedIssueNamespaces: readonly string[],
  issues: HnpConformanceIssue[],
) {
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object') {
    issues.push(issue('INVALID_PROPOSAL', 'payload', 'payload is required'));
    return;
  }
  const record = payload as unknown as Record<string, unknown>;

  if (envelope.type === 'OFFER' || envelope.type === 'COUNTER') {
    requireString(record.proposal_id, 'payload.proposal_id', 'INVALID_PROPOSAL', issues);
    const totalPrice = record.total_price as Record<string, unknown> | undefined;
    if (!totalPrice || typeof totalPrice !== 'object') {
      issues.push(issue('INVALID_PROPOSAL', 'payload.total_price', 'total_price is required'));
    } else {
      if (typeof totalPrice.currency !== 'string' || !/^[A-Z]{3}$/.test(totalPrice.currency)) {
        issues.push(issue('UNSUPPORTED_CURRENCY', 'payload.total_price.currency', 'currency must be ISO-4217 uppercase code'));
      }
      if (typeof totalPrice.units_minor !== 'number' || !Number.isInteger(totalPrice.units_minor) || totalPrice.units_minor <= 0) {
        issues.push(issue('INVALID_PROPOSAL', 'payload.total_price.units_minor', 'units_minor must be a positive integer'));
      }
    }

    const proposalIssues = record.issues;
    if (!Array.isArray(proposalIssues)) {
      issues.push(issue('INVALID_PROPOSAL', 'payload.issues', 'issues must be an array'));
    } else {
      for (const [index, proposalIssue] of proposalIssues.entries()) {
        const issueRecord = proposalIssue as Record<string, unknown>;
        if (typeof issueRecord.issue_id !== 'string') {
          issues.push(issue('INVALID_PROPOSAL', `payload.issues.${index}.issue_id`, 'issue_id is required'));
        } else if (!isSupportedIssueId(issueRecord.issue_id, supportedIssueNamespaces)) {
          issues.push(issue('UNSUPPORTED_ISSUE', `payload.issues.${index}.issue_id`, `Unsupported issue id: ${issueRecord.issue_id}`));
        }
      }
    }
  }

  if (envelope.type === 'ACCEPT') {
    requireString(record.accepted_message_id, 'payload.accepted_message_id', 'INVALID_PROPOSAL', issues);
    requireString(record.accepted_proposal_id, 'payload.accepted_proposal_id', 'INVALID_PROPOSAL', issues);
  }
}

function requireString(
  value: unknown,
  field: string,
  code: HnpErrorCode,
  issues: HnpConformanceIssue[],
) {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(issue(code, field, `${field} is required`));
  }
}

function issue(code: HnpErrorCode, field: string, message: string): HnpConformanceIssue {
  return { code, field, message };
}
