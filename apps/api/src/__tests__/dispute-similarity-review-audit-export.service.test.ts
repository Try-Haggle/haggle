import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSignedDisputeSimilarityReviewAuditExport,
  DisputeSimilarityReviewAuditSigningNotConfiguredError,
  verifySignedDisputeSimilarityReviewAuditExport,
} from "../services/dispute-similarity-review-audit-export.service.js";
import {
  hashDisputeSimilarityExpiryEvent,
  type HashableDisputeSimilarityExpiryEvent,
} from "../services/dispute-similarity-review-expiry.service.js";

const event: HashableDisputeSimilarityExpiryEvent = {
  schema: "haggle.dispute-similarity-review-event.v1",
  event_id: "11111111-1111-4111-8111-111111111111",
  upload_id: "22222222-2222-4222-8222-222222222222",
  dispute_id: "33333333-3333-4333-8333-333333333333",
  event_type: "AUTO_EXPIRED",
  actor_id: null,
  reason: "REVIEW_WINDOW_EXPIRED",
  review_expires_at: "2026-07-12T00:00:00.000Z",
  created_at: "2026-07-12T00:01:00.000Z",
};

describe("dispute similarity review signed audit export", () => {
  it("produces a deterministic event hash and detects mutation", () => {
    expect(hashDisputeSimilarityExpiryEvent(event)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDisputeSimilarityExpiryEvent({ ...event })).toBe(hashDisputeSimilarityExpiryEvent(event));
    expect(hashDisputeSimilarityExpiryEvent({ ...event, reason: "UNKNOWN" })).not.toBe(hashDisputeSimilarityExpiryEvent(event));
  });

  it("signs and verifies a valid sealed event", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const value = createSignedDisputeSimilarityReviewAuditExport({
      event, storedEventHash: hashDisputeSimilarityExpiryEvent(event),
      generatedAt: new Date("2026-07-12T01:00:00.000Z"), privateKey,
    });
    expect(value.manifest).toMatchObject({ integrity_valid: true, event_id: event.event_id });
    expect(value.signature.key_id).toMatch(/^[a-f0-9]{24}$/);
    expect(verifySignedDisputeSimilarityReviewAuditExport(value)).toBe(true);
    expect(verifySignedDisputeSimilarityReviewAuditExport({ ...value, event: { ...event, reason: "UNKNOWN" } })).toBe(false);
  });

  it("refuses an event whose stored hash does not match", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    expect(() => createSignedDisputeSimilarityReviewAuditExport({
      event, storedEventHash: "0".repeat(64), generatedAt: new Date(), privateKey,
    })).toThrow("SIMILARITY_REVIEW_AUDIT_INTEGRITY_INVALID");
  });

  it("requires a configured signing key", () => {
    const previous = process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64;
    delete process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64;
    try {
      expect(() => createSignedDisputeSimilarityReviewAuditExport({
        event, storedEventHash: hashDisputeSimilarityExpiryEvent(event), generatedAt: new Date(),
      })).toThrow(DisputeSimilarityReviewAuditSigningNotConfiguredError);
    } finally {
      if (previous === undefined) delete process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64;
      else process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 = previous;
    }
  });
});
