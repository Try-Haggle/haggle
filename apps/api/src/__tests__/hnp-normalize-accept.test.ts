import { describe, expect, it } from "vitest";
import { normalizeAcceptRequest } from "../hnp/accept-session.js";

const sessionId = "11111111-1111-1111-1111-111111111111";

describe("normalizeAcceptRequest", () => {
  it("keeps the convenience accept path without an envelope", () => {
    const result = normalizeAcceptRequest(
      { accepted_message_id: "msg-1", accepted_proposal_id: "p1" },
      sessionId,
      1_700_000_000_000,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.acceptedMessageId).toBe("msg-1");
      expect(result.protocol).toBeUndefined();
    }
  });

  it("binds an ACCEPT envelope to protocol metadata", () => {
    const result = normalizeAcceptRequest(
      {
        hnp: {
          spec_version: "2026-03-09",
          capability: "hnp.core.negotiation",
          session_id: sessionId,
          message_id: "acc-1",
          idempotency_key: "idem-acc",
          sequence: 3,
          sent_at_ms: 1_700_000_000_000,
          expires_at_ms: 1_700_000_060_000,
          sender_agent_id: "agent.buyer",
          sender_role: "BUYER",
          type: "ACCEPT",
          payload: {
            accepted_message_id: "msg-1",
            accepted_proposal_id: "p1",
            accepted_proposal_hash: "sha256:abc",
          },
        },
      },
      sessionId,
      1_700_000_000_000,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.protocol?.messageType).toBe("ACCEPT");
      expect(result.acceptedProposalHash).toBe("sha256:abc");
    }
  });
});
