import type { Database } from "@haggle/db";
import type { EventDispatcher } from "../lib/event-dispatcher.js";
import { getExecutor } from "../lib/executor-factory.js";
import { validateHnpIngress } from "../services/hnp-ingress.service.js";
import type { HnpOfferEnvelope } from "./envelope-schema.js";
import { normalizeSubmitOffer } from "./normalize-offer.js";

export type SubmitHnpOfferResult =
  | {
      ok: true;
      roundId: string;
      roundNo: number;
      decision: string;
      counterPrice: number;
      sessionStatus: string;
      idempotent: boolean;
      proposalHash?: string;
      utility: unknown;
      escalation?: { type: string; context?: unknown };
    }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function submitHnpOffer(
  db: Database,
  envelope: HnpOfferEnvelope,
  options?: {
    messageText?: string;
    eventDispatcher?: EventDispatcher;
    requireSignature?: boolean;
  },
): Promise<SubmitHnpOfferResult> {
  const nowMs = Date.now();
  const normalized = normalizeSubmitOffer({ hnp: envelope }, envelope.session_id, nowMs);
  if (!normalized.ok) {
    return { ok: false, status: normalized.status, body: normalized.body };
  }

  const hnpIngress = await validateHnpIngress(db, envelope.session_id, {
    envelope: normalized.hnp,
    protocol: normalized.protocol,
    requireSignature: options?.requireSignature,
  });
  if (!hnpIngress.ok) {
    return { ok: false, status: hnpIngress.status, body: hnpIngress.body };
  }

  const result = await getExecutor()(
    db,
    {
      sessionId: envelope.session_id,
      offerPriceMinor: normalized.offerPriceMinor,
      messageText: options?.messageText,
      senderRole: normalized.senderRole,
      idempotencyKey: normalized.idempotencyKey,
      protocol: normalized.protocol,
      roundData: {},
      nowMs,
    },
    options?.eventDispatcher,
  );

  return {
    ok: true,
    roundId: result.roundId,
    roundNo: result.roundNo,
    decision: result.decision,
    counterPrice: result.outgoingPrice,
    sessionStatus: result.sessionStatus,
    idempotent: result.idempotent,
    proposalHash: normalized.protocol?.proposalHash,
    utility: result.utility,
    escalation: result.escalation
      ? { type: result.escalation.type, context: result.escalation.context }
      : undefined,
  };
}
