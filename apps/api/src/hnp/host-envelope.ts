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
}): HnpOfferEnvelope {
  const idempotencyKey = `auto-${input.sessionId}-r${input.roundNo}`;
  return {
    spec_version: HNP_CORE_REVISIONS[0],
    capability: HNP_CORE_CAPABILITY,
    session_id: input.sessionId,
    message_id: idempotencyKey,
    idempotency_key: idempotencyKey,
    sequence: input.roundNo,
    sent_at_ms: input.nowMs,
    expires_at_ms: input.nowMs + ENVELOPE_TTL_MS,
    sender_agent_id: `haggle.autoplay.${input.senderRole.toLowerCase()}`,
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
