import type {
  HnpAcceptPayload,
  HnpActorRole,
  HnpEnvelope,
  HnpEscalatePayload,
  HnpProposalPayload,
  HnpRejectPayload,
} from './core.js';
import { HNP_CORE_CAPABILITY, HNP_CORE_REVISIONS, toMinorUnits, fromMinorUnits } from './core.js';
import type { HnpMessage, HnpMessageType, HnpRole } from './types.js';

export interface LegacyToEnvelopeOptions {
  messageId?: string;
  idempotencyKey?: string;
  correlationId?: string;
  sequence?: number;
  senderAgentId?: string;
  expiresAtMs?: number;
  currency?: string;
  proposalId?: string;
  specVersion?: string;
  capability?: string;
}

export type LegacyHnpEnvelope =
  | HnpEnvelope<HnpProposalPayload>
  | HnpEnvelope<HnpAcceptPayload>
  | HnpEnvelope<HnpRejectPayload>
  | HnpEnvelope<HnpEscalatePayload>;

export function legacyMessageToHnpEnvelope(
  message: HnpMessage,
  options: LegacyToEnvelopeOptions = {},
): LegacyHnpEnvelope {
  const metadata = message.metadata ?? {};
  const sentAtMs = message.timestamp;
  const messageId = options.messageId ?? stringFromMetadata(metadata, 'message_id') ?? `${message.session_id}:${message.round}:${message.type}`;
  const proposalId = options.proposalId ?? stringFromMetadata(metadata, 'proposal_id') ?? `${messageId}:proposal`;

  const base = {
    spec_version: options.specVersion ?? HNP_CORE_REVISIONS[0],
    capability: options.capability ?? HNP_CORE_CAPABILITY,
    session_id: message.session_id,
    message_id: messageId,
    idempotency_key: options.idempotencyKey ?? stringFromMetadata(metadata, 'idempotency_key') ?? messageId,
    correlation_id: options.correlationId ?? stringFromMetadata(metadata, 'correlation_id'),
    sequence: options.sequence ?? message.round,
    sent_at_ms: sentAtMs,
    expires_at_ms: options.expiresAtMs ?? numberFromMetadata(metadata, 'expires_at_ms') ?? sentAtMs + 60_000,
    sender_agent_id: options.senderAgentId ?? stringFromMetadata(metadata, 'sender_agent_id') ?? `${message.sender_role.toLowerCase()}-agent`,
    sender_role: message.sender_role as HnpActorRole,
    detached_signature: stringFromMetadata(metadata, 'detached_signature'),
  };

  switch (message.type) {
    case 'OFFER':
    case 'COUNTER':
      return {
        ...base,
        type: message.type,
        payload: {
          proposal_id: proposalId,
          issues: [{
            issue_id: 'hnp.issue.price.total',
            value: toMinorUnits(message.price),
            unit: options.currency ?? stringFromMetadata(metadata, 'currency') ?? 'USD',
            kind: 'NEGOTIABLE',
          }],
          total_price: {
            currency: options.currency ?? stringFromMetadata(metadata, 'currency') ?? 'USD',
            units_minor: toMinorUnits(message.price),
          },
          proposal_hash: stringFromMetadata(metadata, 'proposal_hash'),
          in_reply_to: stringFromMetadata(metadata, 'in_reply_to'),
        },
      };
    case 'ACCEPT':
      return {
        ...base,
        type: 'ACCEPT',
        payload: {
          accepted_message_id: stringFromMetadata(metadata, 'accepted_message_id') ?? stringFromMetadata(metadata, 'in_reply_to') ?? messageId,
          accepted_proposal_id: stringFromMetadata(metadata, 'accepted_proposal_id') ?? proposalId,
          accepted_proposal_hash: stringFromMetadata(metadata, 'accepted_proposal_hash'),
        },
      };
    case 'REJECT':
      return {
        ...base,
        type: 'REJECT',
        payload: {
          in_reply_to: stringFromMetadata(metadata, 'in_reply_to'),
          reason_code: stringFromMetadata(metadata, 'reason_code'),
          final: booleanFromMetadata(metadata, 'final') ?? true,
        },
      };
    case 'ESCALATE':
      return {
        ...base,
        type: 'ESCALATE',
        payload: {
          escalation_code: escalationCodeFromMetadata(metadata) ?? 'STRATEGY_REVIEW',
          detail: stringFromMetadata(metadata, 'detail'),
        },
      };
  }
}

export function hnpProposalEnvelopeToLegacyMessage(
  envelope: HnpEnvelope<HnpProposalPayload>,
  decimals: number = 2,
): HnpMessage {
  return {
    session_id: envelope.session_id,
    round: envelope.sequence,
    type: envelope.type as Extract<HnpMessageType, 'OFFER' | 'COUNTER'>,
    price: fromMinorUnits(envelope.payload.total_price.units_minor, decimals),
    sender_role: envelope.sender_role as HnpRole,
    timestamp: envelope.sent_at_ms,
    metadata: {
      message_id: envelope.message_id,
      idempotency_key: envelope.idempotency_key,
      correlation_id: envelope.correlation_id,
      sender_agent_id: envelope.sender_agent_id,
      expires_at_ms: envelope.expires_at_ms,
      proposal_id: envelope.payload.proposal_id,
      proposal_hash: envelope.payload.proposal_hash,
      currency: envelope.payload.total_price.currency,
      hnp: envelope,
    },
  };
}

export function isHnpProposalEnvelope(envelope: HnpEnvelope): envelope is HnpEnvelope<HnpProposalPayload> {
  return (envelope.type === 'OFFER' || envelope.type === 'COUNTER') && hasTotalPrice(envelope.payload);
}

function hasTotalPrice(payload: unknown): payload is HnpProposalPayload {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    'total_price' in payload &&
    typeof (payload as { total_price?: unknown }).total_price === 'object',
  );
}

function stringFromMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

function numberFromMetadata(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanFromMetadata(metadata: Record<string, unknown>, key: string): boolean | undefined {
  const value = metadata[key];
  return typeof value === 'boolean' ? value : undefined;
}

function escalationCodeFromMetadata(metadata: Record<string, unknown>): HnpEscalatePayload['escalation_code'] | undefined {
  const value = stringFromMetadata(metadata, 'escalation_code');
  if (value === 'UNKNOWN_PROPOSAL' || value === 'STRATEGY_REVIEW' || value === 'HUMAN_APPROVAL_REQUIRED') return value;
  return undefined;
}
