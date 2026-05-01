// HNP Core Wire Types (P0)
// Canonical envelope, money, payloads, and error codes for the HNP protocol.

export const HNP_CORE_REVISIONS = ['2026-03-09'] as const;
export type HnpCoreRevision = (typeof HNP_CORE_REVISIONS)[number] | string;

export const HNP_CORE_CAPABILITY = 'hnp.core.negotiation' as const;

export const HNP_TRANSPORTS = ['rest', 'mcp', 'grpc', 'ws', 'a2a'] as const;
export type HnpTransport = (typeof HNP_TRANSPORTS)[number];

export const HNP_COMPATIBILITY_LEVELS = ['FULL', 'DEGRADED', 'INCOMPATIBLE'] as const;
export type HnpCompatibilityLevel = (typeof HNP_COMPATIBILITY_LEVELS)[number];

export const HNP_ERROR_CODES = [
  'UNSUPPORTED_VERSION',
  'UNSUPPORTED_EXTENSION',
  'UNSUPPORTED_ISSUE',
  'UNSUPPORTED_CURRENCY',
  'INVALID_SIGNATURE',
  'STALE_MESSAGE',
  'OUT_OF_ORDER',
  'DUPLICATE_OR_STALE',
  'INVALID_PROPOSAL',
  'EXPIRED_PROPOSAL',
  'PROPOSAL_CONFLICT',
  'SESSION_NOT_FOUND',
  'ESCALATION_REQUIRED',
  'SIGNATURE_REQUIRED',
  'SETTLEMENT_UNAVAILABLE',
  'POLICY_BLOCKED',
  'RATE_LIMITED',
] as const;
export type HnpErrorCode = (typeof HNP_ERROR_CODES)[number];

/** Integer minor-unit money representation to avoid floating-point issues (P0-4). */
export interface HnpMoney {
  currency: string;
  units_minor: number;
}

/** Multi-term issue value for multi-issue negotiation. */
export interface HnpIssueValue {
  issue_id: string;
  value: string | number | boolean;
  unit?: string;
  kind?: 'NEGOTIABLE' | 'INFORMATIONAL';
}

export type HnpActorRole = 'BUYER' | 'SELLER' | 'MEDIATOR';

export type HnpCoreMessageType =
  | 'HELLO'
  | 'CAPABILITIES'
  | 'OFFER'
  | 'COUNTER'
  | 'ACCEPT'
  | 'REJECT'
  | 'ESCALATE'
  | 'CANCEL'
  | 'ACK'
  | 'ERROR';

/** OFFER / COUNTER payload. */
export interface HnpProposalPayload {
  proposal_id: string;
  issues: HnpIssueValue[];
  total_price: HnpMoney;
  /** Stable hash of proposal terms for exact accept/settlement binding. */
  proposal_hash?: string;
  rationale_code?: string;
  valid_until?: string;
  in_reply_to?: string;
  settlement_preconditions?: string[];
}

/** ACCEPT payload — binds to a specific proposal (P0-3). */
export interface HnpAcceptPayload {
  accepted_message_id: string;
  accepted_proposal_id: string;
  /** Optional proposal hash binding to prevent accepting a mutated proposal. */
  accepted_proposal_hash?: string;
  /** Optional exact issue snapshot accepted by both parties. */
  accepted_issues?: HnpIssueValue[];
}

/** REJECT payload. */
export interface HnpRejectPayload {
  in_reply_to?: string;
  reason_code?: string;
  final: boolean;
}

/** ESCALATE payload — separated from ERROR (P0-5). */
export interface HnpEscalatePayload {
  escalation_code: 'UNKNOWN_PROPOSAL' | 'STRATEGY_REVIEW' | 'HUMAN_APPROVAL_REQUIRED';
  detail?: string;
}

/** ACK payload. */
export interface HnpAckPayload {
  acked_message_id: string;
  status: 'RECEIVED' | 'APPLIED' | 'FINALIZED';
}

/** ERROR payload — separated from ESCALATE (P0-5). */
export interface HnpErrorPayload {
  code: HnpErrorCode;
  message: string;
  retryable: boolean;
  related_message_id?: string;
}

/** Capability payload used by HELLO / CAPABILITIES messages. */
export interface HnpCapabilitiesPayload {
  supported_revisions: HnpCoreRevision[];
  transports: HnpTransport[];
  issue_namespaces: string[];
  signature_algorithms: string[];
  settlement_modes: string[];
  required_extensions?: string[];
  optional_extensions?: string[];
}

/** Initial capability announcement. */
export interface HnpHelloPayload {
  agent_id: string;
  display_name?: string;
  capabilities: HnpCapabilitiesPayload;
}

export type HnpCorePayload =
  | HnpHelloPayload
  | HnpCapabilitiesPayload
  | HnpProposalPayload
  | HnpAcceptPayload
  | HnpRejectPayload
  | HnpEscalatePayload
  | HnpAckPayload
  | HnpErrorPayload;

/** Canonical envelope wrapping every HNP message on the wire (P0-2). */
export interface HnpEnvelope<TPayload = HnpCorePayload> {
  spec_version: HnpCoreRevision;
  capability: string;
  session_id: string;
  message_id: string;
  idempotency_key: string;
  correlation_id?: string;
  sequence: number;
  sent_at_ms: number;
  expires_at_ms: number;
  sender_agent_id: string;
  sender_role: HnpActorRole;
  type: HnpCoreMessageType;
  payload: TPayload;
  /** Detached JWS signature for authentication/integrity (P0-6). */
  detached_signature?: string;
}

/** Convert a decimal amount to integer minor units (e.g. 49.99 → 4999). */
export function toMinorUnits(amount: number, decimals: number = 2): number {
  const factor = 10 ** decimals;
  return Math.round((amount + Number.EPSILON) * factor);
}

/** Convert integer minor units back to a decimal amount (e.g. 4999 → 49.99). */
export function fromMinorUnits(unitsMinor: number, decimals: number = 2): number {
  const factor = 10 ** decimals;
  return unitsMinor / factor;
}
