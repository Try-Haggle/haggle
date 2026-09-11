import { describe, expect, it } from "vitest";
import { validateSessionParticipant, validateSessionWriteAccess } from "../lib/session-access.js";

const buyer = { id: "buyer-1", role: "user" };
const seller = { id: "seller-1", role: "user" };
const session = { buyerId: "buyer-1", sellerId: "seller-1" };

describe("session write access", () => {
  it("lets a buyer act only as BUYER", () => {
    expect(
      validateSessionWriteAccess(buyer, session, {
        senderRole: "BUYER",
        senderAgentId: buyer.id,
        action: "offer",
      }),
    ).toEqual({ ok: true });
    expect(
      validateSessionWriteAccess(buyer, session, {
        senderRole: "SELLER",
        senderAgentId: seller.id,
        action: "offer",
      }),
    ).toEqual({ ok: false, status: 403, error: "SESSION_ACTOR_MISMATCH" });
  });

  it("lets a seller act only as SELLER", () => {
    expect(
      validateSessionWriteAccess(seller, session, {
        senderRole: "SELLER",
        senderAgentId: seller.id,
        action: "accept",
      }),
    ).toEqual({ ok: true });
    expect(
      validateSessionWriteAccess(seller, session, {
        senderRole: "BUYER",
        senderAgentId: buyer.id,
        action: "accept",
      }),
    ).toEqual({ ok: false, status: 403, error: "SESSION_ACTOR_MISMATCH" });
  });

  it("rejects a foreign sender_agent_id without a live delegation", () => {
    expect(
      validateSessionWriteAccess(buyer, session, {
        senderRole: "BUYER",
        senderAgentId: "agent-not-the-user",
        action: "offer",
      }),
    ).toEqual({ ok: false, status: 403, error: "HNP_SENDER_AGENT_MISMATCH" });
  });

  it("treats participant-only access as insufficient for the other side", () => {
    expect(validateSessionParticipant(buyer, session)).toEqual({ ok: true });
    expect(
      validateSessionWriteAccess(buyer, session, { senderRole: "SELLER", action: "offer" }),
    ).toEqual({ ok: false, status: 403, error: "SESSION_ACTOR_MISMATCH" });
  });
});
