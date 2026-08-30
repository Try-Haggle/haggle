import { HNP_CORE_CAPABILITY } from "@haggle/engine-session";
import { describe, expect, it } from "vitest";
import { buildHostHnpOfferEnvelope, wrapPriceOnlyAsHostEnvelope } from "../hnp/host-envelope.js";
import { normalizeSubmitOffer } from "../hnp/normalize-offer.js";

const sessionId = "11111111-1111-1111-1111-111111111111";

describe("buildHostHnpOfferEnvelope", () => {
  it("builds a stable opening OFFER that normalizes like any other HNP message", () => {
    const envelope = buildHostHnpOfferEnvelope({
      sessionId,
      roundNo: 1,
      senderRole: "BUYER",
      priceMinor: 9000,
      nowMs: 1_700_000_000_000,
    });

    expect(envelope.capability).toBe(HNP_CORE_CAPABILITY);
    expect(envelope.type).toBe("OFFER");
    expect(envelope.sender_agent_id).toBe("haggle.autoplay.buyer");
    expect(envelope.message_id).toBe(`auto-${sessionId}-r1`);
    expect(envelope.sequence).toBe(1);

    const normalized = normalizeSubmitOffer({ hnp: envelope }, sessionId, 1_700_000_000_000);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.offerPriceMinor).toBe(9000);
      expect(normalized.protocol?.proposalHash).toMatch(/^sha256:/);
    }
  });

  it("uses COUNTER after the opening round and keeps retry identity stable", () => {
    const first = buildHostHnpOfferEnvelope({
      sessionId,
      roundNo: 2,
      senderRole: "SELLER",
      priceMinor: 135000,
      nowMs: 1,
    });
    const retry = buildHostHnpOfferEnvelope({
      sessionId,
      roundNo: 2,
      senderRole: "SELLER",
      priceMinor: 135000,
      nowMs: 2,
    });

    expect(first.type).toBe("COUNTER");
    expect(first.message_id).toBe(retry.message_id);
    expect(first.idempotency_key).toBe(retry.idempotency_key);
    expect(first.sequence).toBe(retry.sequence);
  });

  it("wraps a price-only REST offer as a host envelope that still ingresses", () => {
    const envelope = wrapPriceOnlyAsHostEnvelope({
      sessionId,
      currentRound: 0,
      senderRole: "BUYER",
      priceMinor: 37000,
      idempotencyKey: "client-idem-1",
      nowMs: 1_700_000_000_000,
    });

    expect(envelope.sender_agent_id).toBe("haggle.host.buyer");
    expect(envelope.idempotency_key).toBe("client-idem-1");
    expect(envelope.type).toBe("OFFER");
    expect(envelope.sequence).toBe(1);

    const normalized = normalizeSubmitOffer({ hnp: envelope }, sessionId, 1_700_000_000_000);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.offerPriceMinor).toBe(37000);
      expect(normalized.protocol?.senderAgentId).toBe("haggle.host.buyer");
    }
  });
});
