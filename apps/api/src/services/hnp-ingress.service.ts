import type { Database } from "@haggle/db";
import {
  type HnpConformanceIssue,
  type HnpEnvelope,
  validateHnpEnvelopeConformance,
} from "@haggle/engine-session";
import {
  type HnpProtocolIdentity,
  validateHnpProtocolOrder,
} from "./hnp-protocol-guard.service.js";
import {
  type HnpSignedEnvelope,
  isHnpSignatureRequired,
  validateHnpDetachedSignature,
} from "./hnp-signature.service.js";
import { getRoundsBySessionId } from "./negotiation-round.service.js";

export type HnpIngressResult =
  | { ok: true }
  | {
      ok: false;
      status: 400 | 401 | 409;
      body: {
        error: "INVALID_SIGNATURE" | "DUPLICATE_OR_STALE" | "OUT_OF_ORDER" | "INVALID_HNP_ENVELOPE";
        retryable: false;
        related_message_id?: string;
        issues?: HnpConformanceIssue[];
      };
    };

export interface HnpIngressInput {
  envelope?: HnpSignedEnvelope;
  protocol?: HnpProtocolIdentity;
  /** Override. Host auto-play mints unsigned envelopes after our own run-token gate. */
  requireSignature?: boolean;
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
    const requireSignature = input.requireSignature ?? isHnpSignatureRequired();
    const hasSignature = typeof input.envelope.detached_signature === "string";
    if (requireSignature || hasSignature) {
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
    }

    const conformance = validateHnpEnvelopeConformance(input.envelope as Partial<HnpEnvelope>, {
      supportedIssueNamespaces: supportedIssueNamespaces(),
      requireSignature,
    });
    if (!conformance.ok) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "INVALID_HNP_ENVELOPE",
          retryable: false,
          related_message_id:
            typeof input.envelope.message_id === "string" ? input.envelope.message_id : undefined,
          issues: conformance.issues,
        },
      };
    }
  }

  if (input.protocol) {
    const rounds = await getRoundsBySessionId(db, sessionId);
    const protocolGuard = validateHnpProtocolOrder(
      rounds.map((round) => ({
        id: round.id,
        idempotencyKey: round.idempotencyKey,
        metadata: round.metadata as Record<string, unknown> | null,
      })),
      input.protocol,
    );

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
