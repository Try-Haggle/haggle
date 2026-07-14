import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSignedDisputeAiAuditExport,
  DisputeAuditSigningNotConfiguredError,
  verifySignedDisputeAiAuditExport,
} from "../services/dispute-ai-audit-export.service.js";

function signedFixture() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return createSignedDisputeAiAuditExport({
    disputeId: "11111111-1111-4111-8111-111111111111",
    generatedAt: new Date("2026-07-12T03:20:00.000Z"),
    privateKey,
    events: [{
      id: "event-1",
      disputeId: "11111111-1111-4111-8111-111111111111",
      eventType: "COMPLETED",
      revision: 1,
      evidenceSnapshotHash: "evidence-1",
      policyVersion: "policy-1",
      contextHash: "context-1",
      requestedBy: "admin-1",
      forced: false,
      payload: { conclusion: "buyer_favor" },
      createdAt: "2026-07-12T03:19:00.000Z",
      previousEventHash: null,
      eventHash: "event-hash-1",
    }],
    chain: {
      valid: true,
      complete: true,
      headEventHash: "event-hash-1",
      sealedEvents: 1,
      legacyUnsealedEvents: 0,
    },
  });
}

describe("signed dispute AI audit export", () => {
  it("signs and verifies a canonical Ed25519 manifest", () => {
    const value = signedFixture();
    expect(value.signature.algorithm).toBe("Ed25519");
    expect(value.signature.key_id).toMatch(/^[a-f0-9]{24}$/);
    expect(verifySignedDisputeAiAuditExport(value)).toBe(true);
  });

  it("rejects event mutation after signing", () => {
    const value = signedFixture();
    value.events[0]!.payload = { conclusion: "seller_favor" };
    expect(verifySignedDisputeAiAuditExport(value)).toBe(false);
  });

  it("rejects a forged key id and malformed public key without throwing", () => {
    const value = signedFixture();
    value.signature.key_id = "0".repeat(24);
    expect(verifySignedDisputeAiAuditExport(value)).toBe(false);
    value.signature.public_key_spki_base64 = "not-a-public-key";
    expect(verifySignedDisputeAiAuditExport(value)).toBe(false);
  });

  it("fails closed when a signing key is not configured", () => {
    expect(() => createSignedDisputeAiAuditExport({
      disputeId: "11111111-1111-4111-8111-111111111111",
      generatedAt: new Date(),
      privateKeyBase64: "",
      events: [],
      chain: { valid: true, complete: true, headEventHash: null, sealedEvents: 0, legacyUnsealedEvents: 0 },
    })).toThrow(DisputeAuditSigningNotConfiguredError);
  });
});
