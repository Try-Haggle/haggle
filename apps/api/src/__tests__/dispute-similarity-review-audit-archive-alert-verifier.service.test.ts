import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import {
  claimVerifiedDisputeSimilarityArchiveAlert,
  verifyDisputeSimilarityReviewAuditArchiveAlert,
} from "../services/dispute-similarity-review-audit-archive-alert-verifier.service.js";
import { signWebhookClaimAlertPayload } from "../services/webhook-claim-alert.service.js";
import { claimWebhookEvent } from "../services/webhook-event-claim.service.js";

vi.mock("../services/webhook-event-claim.service.js", () => ({ claimWebhookEvent: vi.fn() }));

const secret = "cycle60-alert-verifier-secret";
const timestamp = "2026-07-12T12:00:00.000Z";
const deliveryId = `health_${"a".repeat(64)}`;
const body = JSON.stringify({
  type: "dispute_similarity_review_audit_archive.health",
  delivery_id: deliveryId,
  state: "firing",
  created_at: timestamp,
  severity: "critical",
  reasons: ["similarity_audit_archive_dead_letter"],
  health: { status: "critical", deadLetter: 1 },
});

function verify(overrides: Record<string, unknown> = {}) {
  return verifyDisputeSimilarityReviewAuditArchiveAlert({
    rawBody: body,
    timestamp,
    deliveryId,
    signature: signWebhookClaimAlertPayload(secret, timestamp, body),
    secret,
    nowMs: Date.parse(timestamp),
    ...overrides,
  });
}

describe("similarity audit archive alert receiver verification", () => {
  it("accepts a fresh delivery whose body, header, and HMAC are bound", () => {
    expect(verify()).toMatchObject({ ok: true, deliveryId, state: "firing", severity: "critical" });
  });

  it("rejects stale timestamps before accepting the delivery", () => {
    expect(verify({ nowMs: Date.parse(timestamp) + 5 * 60_000 + 1 })).toEqual({
      ok: false,
      error: "ALERT_TIMESTAMP_OUT_OF_RANGE",
    });
  });

  it("rejects delivery ID mismatch and body tampering", () => {
    expect(verify({ deliveryId: `health_${"b".repeat(64)}` })).toEqual({
      ok: false,
      error: "ALERT_DELIVERY_ID_MISMATCH",
    });
    expect(verify({ signature: `sha256=${"0".repeat(64)}` })).toEqual({
      ok: false,
      error: "INVALID_ALERT_SIGNATURE",
    });
  });

  it("claims a verified delivery once and treats the second claim as replay", async () => {
    const verified = verify();
    if (!verified.ok) throw new Error("fixture verification failed");
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({
        outcome: "acquired",
        source: "receiver",
        eventId: deliveryId,
        claimId: "11111111-1111-4111-8111-111111111111",
        attemptCount: 1,
      })
      .mockResolvedValueOnce({ outcome: "duplicate", source: "receiver", eventId: deliveryId })
      .mockResolvedValueOnce({
        outcome: "payload_conflict",
        source: "receiver",
        eventId: deliveryId,
      });
    await expect(
      claimVerifiedDisputeSimilarityArchiveAlert({} as Database, verified),
    ).resolves.toMatchObject({ outcome: "accepted" });
    await expect(
      claimVerifiedDisputeSimilarityArchiveAlert({} as Database, verified),
    ).resolves.toEqual({ outcome: "replay_or_in_progress" });
    await expect(
      claimVerifiedDisputeSimilarityArchiveAlert({} as Database, verified),
    ).resolves.toEqual({ outcome: "payload_conflict" });
  });
});
