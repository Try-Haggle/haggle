import { describe, expect, it } from "vitest";
import { a2aTaskPartToHnpEnvelope, A2A_HNP_SKILL, hnpEnvelopeToA2ATaskPart } from "../src/protocol/bindings/a2a.js";
import { hnpAgreementToUcpCheckoutBridge, UCP_HNP_EXTENSION_ID } from "../src/protocol/bindings/ucp.js";
import type { HnpEnvelope, HnpProposalPayload } from "../src/protocol/core.js";

describe("HNP commerce bindings", () => {
  it("bridges an accepted HNP deal into a UCP checkout extension without catalog fields", () => {
    const bridge = hnpAgreementToUcpCheckoutBridge({
      listing: { source: "marketplace.example", listing_id: "lst_1" },
      agreement_hash: "sha256:abc",
      accepted_total: { currency: "USD", units_minor: 48000 },
      accepted_issues: [{ issue_id: "hnp.issue.condition.battery_health", value: "87%" }],
      settlement_preconditions: ["escrow_authorized"],
    });

    expect(bridge.extension).toBe(UCP_HNP_EXTENSION_ID);
    expect(bridge.listing.listing_id).toBe("lst_1");
    expect(bridge.accepted_total.units_minor).toBe(48000);
    expect(JSON.stringify(bridge)).not.toContain("search");
    expect(JSON.stringify(bridge)).not.toContain("rank");
  });

  it("wraps and unwraps an HNP envelope as an A2A task part", () => {
    const envelope: HnpEnvelope<HnpProposalPayload> = {
      spec_version: "2026-03-09",
      capability: "hnp.core.negotiation",
      session_id: "11111111-1111-1111-1111-111111111111",
      message_id: "msg-1",
      idempotency_key: "idem-1",
      sequence: 1,
      sent_at_ms: 1_700_000_000_000,
      expires_at_ms: 1_700_000_060_000,
      sender_agent_id: "agent.buyer",
      sender_role: "BUYER",
      type: "OFFER",
      payload: {
        proposal_id: "p1",
        issues: [],
        total_price: { currency: "USD", units_minor: 37000 },
      },
    };

    const part = hnpEnvelopeToA2ATaskPart(envelope);
    expect(part.skill).toBe(A2A_HNP_SKILL);
    expect(part.mime_type).toBe("application/hnp+json");
    expect(a2aTaskPartToHnpEnvelope(part).message_id).toBe("msg-1");
  });
});
