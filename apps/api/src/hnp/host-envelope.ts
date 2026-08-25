import { HNP_CORE_CAPABILITY, HNP_CORE_REVISIONS } from "@haggle/engine-session";
import type { HnpOfferEnvelope } from "./envelope-schema.js";

const ENVELOPE_TTL_MS = 60_000;

/** Haggle's own auto-play agents speak HNP. Identity is stable for retries. */
export function buildHostHnpOfferEnvelope(input: {
  sessionId: string;
  roundNo: number;
  senderRole: "BUYER" | "SELLER";
  priceMinor: number;
  nowMs: number;
  senderAgentId?: string;
  idempotencyKey?: string;
}): HnpOfferEnvelope {
  const idempotencyKey = input.idempotencyKey ?? `auto-${input.sessionId}-r${input.roundNo}`;
  return {
    spec_version: HNP_CORE_REVISIONS[0],
    capability: HNP_CORE_CAPABILITY,
    session_id: input.sessionId,
    message_id: idempotencyKey,
    idempotency_key: idempotencyKey,
    sequence: input.roundNo,
    sent_at_ms: input.nowMs,
    expires_at_ms: input.nowMs + ENVELOPE_TTL_MS,
    sender_agent_id: input.senderAgentId ?? `haggle.autoplay.${input.senderRole.toLowerCase()}`,
    sender_role: input.senderRole,
    type: input.roundNo === 1 ? "OFFER" : "COUNTER",
    payload: {
      proposal_id: idempotencyKey,
      issues: [],
      total_price: {
        currency: "USD",
        units_minor: input.priceMinor,
      },
    },
  };
}

/**
 * REST `{ price_minor }` is a host convenience, not a second protocol.
 * Wrap it as an unsigned host envelope so ingress still runs.
 */
export function wrapPriceOnlyAsHostEnvelope(input: {
  sessionId: string;
  currentRound: number;
  senderRole: "BUYER" | "SELLER";
  priceMinor: number;
  idempotencyKey: string;
  nowMs: number;
}): HnpOfferEnvelope {
  return buildHostHnpOfferEnvelope({
    sessionId: input.sessionId,
    roundNo: input.currentRound + 1,
    senderRole: input.senderRole,
    priceMinor: input.priceMinor,
    nowMs: input.nowMs,
    senderAgentId: `haggle.host.${input.senderRole.toLowerCase()}`,
    idempotencyKey: input.idempotencyKey,
  });
}
