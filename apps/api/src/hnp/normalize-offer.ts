import { computeHnpProposalHash } from "@haggle/engine-session";
import type { HnpOfferEnvelope } from "./envelope-schema.js";

export interface NormalizeSubmitOfferInput {
  price_minor?: number;
  sender_role?: "BUYER" | "SELLER";
  idempotency_key?: string;
  hnp?: HnpOfferEnvelope;
}

export type NormalizedSubmitOffer =
  | {
      ok: true;
      offerPriceMinor: number;
      senderRole: "BUYER" | "SELLER";
      idempotencyKey: string;
      protocol?: {
        specVersion: string;
        capability: string;
        messageId: string;
        idempotencyKey: string;
        proposalId: string;
        proposalHash?: string;
        messageType: string;
        currency?: string;
        issues?: Array<{
          issue_id: string;
          value: string | number | boolean;
          unit?: string;
          kind?: "NEGOTIABLE" | "INFORMATIONAL";
        }>;
        settlementPreconditions?: string[];
        sequence: number;
        senderAgentId: string;
        expiresAtMs: number;
      };
      hnp?: HnpOfferEnvelope;
    }
  | { ok: false; status: number; body: Record<string, unknown> };

export function normalizeSubmitOffer(
  body: NormalizeSubmitOfferInput,
  sessionId: string,
  nowMs: number,
): NormalizedSubmitOffer {
  if (!body.hnp) {
    return {
      ok: true,
      offerPriceMinor: body.price_minor!,
      senderRole: body.sender_role!,
      idempotencyKey: body.idempotency_key!,
    };
  }

  const envelope = body.hnp;
  if (envelope.session_id !== sessionId) {
    return {
      ok: false,
      status: 400,
      body: { error: "HNP_SESSION_MISMATCH" },
    };
  }

  if (envelope.expires_at_ms <= nowMs) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "STALE_MESSAGE",
        retryable: false,
        related_message_id: envelope.message_id,
      },
    };
  }

  const computedProposalHash = computeHnpProposalHash({
    proposal_id: envelope.payload.proposal_id,
    issues: envelope.payload.issues,
    total_price: envelope.payload.total_price,
    valid_until: envelope.payload.valid_until,
    settlement_preconditions: envelope.payload.settlement_preconditions,
  });
  if (envelope.payload.proposal_hash && envelope.payload.proposal_hash !== computedProposalHash) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "HNP_PROPOSAL_HASH_MISMATCH",
        retryable: false,
        related_message_id: envelope.message_id,
        expected_proposal_hash: computedProposalHash,
      },
    };
  }
  const proposalHash = envelope.payload.proposal_hash ?? computedProposalHash;

  return {
    ok: true,
    offerPriceMinor: envelope.payload.total_price.units_minor,
    senderRole: envelope.sender_role,
    idempotencyKey: envelope.idempotency_key,
    protocol: {
      specVersion: envelope.spec_version,
      capability: envelope.capability,
      messageId: envelope.message_id,
      idempotencyKey: envelope.idempotency_key,
      proposalId: envelope.payload.proposal_id,
      proposalHash,
      messageType: envelope.type,
      currency: envelope.payload.total_price.currency,
      issues: envelope.payload.issues,
      settlementPreconditions: envelope.payload.settlement_preconditions,
      sequence: envelope.sequence,
      senderAgentId: envelope.sender_agent_id,
      expiresAtMs: envelope.expires_at_ms,
    },
    hnp: envelope,
  };
}
