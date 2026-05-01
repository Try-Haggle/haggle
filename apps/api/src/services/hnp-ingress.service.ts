import type { Database } from "@haggle/db";
import {
  validateHnpEnvelopeConformance,
  type HnpConformanceIssue,
  type HnpEnvelope,
} from "@haggle/engine-session";
import { getRoundsBySessionId } from "./negotiation-round.service.js";
import {
  validateHnpProtocolOrder,
  type HnpProtocolIdentity,
} from "./hnp-protocol-guard.service.js";
import {
  isHnpSignatureRequired,
  validateHnpDetachedSignature,
  type HnpSignedEnvelope,
} from "./hnp-signature.service.js";

export type HnpIngressResult =
  | { ok: true }
  | {
      ok: false;
      status: 400 | 401 | 409;
      body: {
        error:
          | "INVALID_SIGNATURE"
          | "DUPLICATE_OR_STALE"
          | "OUT_OF_ORDER"
          | "INVALID_HNP_ENVELOPE";
        retryable: false;
        related_message_id?: string;
        issues?: HnpConformanceIssue[];
      };
    };

export interface HnpIngressInput {
  envelope?: HnpSignedEnvelope;
  protocol?: HnpProtocolIdentity;
}

/**
 * Wire-protocol ingress validation.
 *
 * This service intentionally stops at HNP concerns: signature integrity,
 * idempotency, and message ordering. It must not call the negotiation engine
 * or validate strategy/price decisions.
 */
export async function validateHnpIngress(
  db: Database,
  sessionId: string,
  input: HnpIngressInput,
): Promise<HnpIngressResult> {
  if (input.envelope) {
    const signatureGuard = validateHnpDetachedSignature(input.envelope);
    if (!signatureGuard.ok) {
      return {
        ok: false,
        status: signatureGuard.status,
        body: {
          error: signatureGuard.error,
          retryable: false,
          related_message_id: signatureGuard.relatedMessageId,
        },
      };
    }

    const conformance = validateHnpEnvelopeConformance(input.envelope as Partial<HnpEnvelope>, {
      supportedIssueNamespaces: supportedIssueNamespaces(),
      requireSignature: isHnpSignatureRequired(),
    });
    if (!conformance.ok) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "INVALID_HNP_ENVELOPE",
          retryable: false,
          related_message_id: typeof input.envelope.message_id === "string"
            ? input.envelope.message_id
            : undefined,
          issues: conformance.issues,
        },
      };
    }
  }

  if (input.protocol) {
    const rounds = await getRoundsBySessionId(db, sessionId);
    const protocolGuard = validateHnpProtocolOrder(rounds.map((round) => ({
      id: round.id,
      idempotencyKey: round.idempotencyKey,
      metadata: round.metadata as Record<string, unknown> | null,
    })), input.protocol);

    if (!protocolGuard.ok) {
      return {
        ok: false,
        status: protocolGuard.status,
        body: {
          error: protocolGuard.error,
          retryable: false,
          related_message_id: protocolGuard.relatedMessageId,
        },
      };
    }
  }

  return { ok: true };
}

function supportedIssueNamespaces(): string[] {
  const configured = process.env.HNP_SUPPORTED_ISSUE_NAMESPACES?.trim();
  if (!configured) return ["hnp.issue", "com.haggle.issue", "vendor"];
  return configured
    .split(",")
    .map((namespace) => namespace.trim())
    .filter(Boolean);
}
