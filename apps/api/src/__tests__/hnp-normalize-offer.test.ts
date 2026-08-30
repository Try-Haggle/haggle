import { computeHnpProposalHash } from "@haggle/engine-session";
import { describe, expect, it } from "vitest";
import { normalizeSubmitOffer } from "../hnp/normalize-offer.js";

const sessionId = "11111111-1111-1111-1111-111111111111";

describe("normalizeSubmitOffer", () => {
  it("keeps the price-only convenience path", () => {
    const result = normalizeSubmitOffer(
      { price_minor: 37000, sender_role: "BUYER", idempotency_key: "idem-1" },
      sessionId,
      1_700_000_000_000,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offerPriceMinor).toBe(37000);
      expect(result.protocol).toBeUndefined();
    }
  });

  it("binds an HNP envelope to protocol metadata and a proposal hash", () => {
    const issues = [{ issue_id: "hnp.issue.condition.battery_health", value: "87%" }];
    const total_price = { currency: "USD", units_minor: 48000 };
    const proposal_id = "p1";
    const result = normalizeSubmitOffer(
      {
        hnp: {
          spec_version: "2026-03-09",
          capability: "hnp.core.negotiation",
          session_id: sessionId,
          message_id: "msg-1",
          idempotency_key: "idem-hnp",
          sequence: 1,
          sent_at_ms: 1_700_000_000_000,
          expires_at_ms: 1_700_000_060_000,
          sender_agent_id: "agent.buyer",
          sender_role: "BUYER",
          type: "OFFER",
          payload: { proposal_id, issues, total_price },
        },
      },
      sessionId,
      1_700_000_000_000,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offerPriceMinor).toBe(48000);
      expect(result.protocol?.proposalHash).toBe(
        computeHnpProposalHash({ proposal_id, issues, total_price }),
      );
    }
  });

  it("rejects a session mismatch before the engine", () => {
    const result = normalizeSubmitOffer(
      {
        hnp: {
          spec_version: "2026-03-09",
          capability: "hnp.core.negotiation",
          session_id: "22222222-2222-2222-2222-222222222222",
          message_id: "msg-1",
          idempotency_key: "idem-hnp",
          sequence: 1,
          sent_at_ms: 1_700_000_000_000,
          expires_at_ms: 1_700_000_060_000,
          sender_agent_id: "agent.buyer",
          sender_role: "BUYER",
          type: "OFFER",
          payload: {
            proposal_id: "p1",
            issues: [],
            total_price: { currency: "USD", units_minor: 100 },
          },
        },
      },
      sessionId,
      1_700_000_000_000,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.body.error).toBe("HNP_SESSION_MISMATCH");
  });
});
