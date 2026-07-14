import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { signWebhookClaimAlertPayload } from "../services/webhook-claim-alert.service.js";
import { claimVerifiedDisputeAiArchiveAlert, verifyDisputeAiAuditArchiveAlert } from "../services/dispute-ai-audit-archive-alert-verifier.service.js";
import { claimWebhookEvent } from "../services/webhook-event-claim.service.js";
vi.mock("../services/webhook-event-claim.service.js", () => ({ claimWebhookEvent: vi.fn() }));
const secret = "cycle65-ai-alert-verifier-secret";
const timestamp = "2026-07-12T12:00:00.000Z";
const deliveryId = `health_${"a".repeat(64)}`;
const body = JSON.stringify({ type: "dispute_ai_audit_archive.health", delivery_id: deliveryId,
  state: "firing", created_at: timestamp, severity: "critical", reasons: ["ai_audit_archive_dead_letter"],
  health: { status: "critical", deadLetter: 1 } });
function verify(overrides: Record<string, unknown> = {}) {
  return verifyDisputeAiAuditArchiveAlert({ rawBody: body, timestamp, deliveryId,
    signature: signWebhookClaimAlertPayload(secret, timestamp, body), secret, nowMs: Date.parse(timestamp), ...overrides });
}
describe("dispute AI audit archive alert receiver verification", () => {
  it("accepts a fresh body/header/HMAC-bound delivery", () => {
    expect(verify()).toMatchObject({ ok: true, deliveryId, state: "firing", severity: "critical" });
  });
  it("rejects stale timestamps", () => {
    expect(verify({ nowMs: Date.parse(timestamp) + 300_001 })).toEqual({ ok: false, error: "ALERT_TIMESTAMP_OUT_OF_RANGE" });
  });
  it("rejects delivery mismatch and body tampering", () => {
    expect(verify({ deliveryId: `health_${"b".repeat(64)}` })).toEqual({ ok: false, error: "ALERT_DELIVERY_ID_MISMATCH" });
    expect(verify({ signature: `sha256=${"0".repeat(64)}` })).toEqual({ ok: false, error: "INVALID_ALERT_SIGNATURE" });
  });
  it("claims once then separates replay and payload conflict", async () => {
    const verified = verify(); if (!verified.ok) throw new Error("fixture failed");
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "acquired", source: "receiver", eventId: deliveryId,
      claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 })
      .mockResolvedValueOnce({ outcome: "duplicate", source: "receiver", eventId: deliveryId })
      .mockResolvedValueOnce({ outcome: "payload_conflict", source: "receiver", eventId: deliveryId });
    await expect(claimVerifiedDisputeAiArchiveAlert({} as Database, verified)).resolves.toMatchObject({ outcome: "accepted" });
    await expect(claimVerifiedDisputeAiArchiveAlert({} as Database, verified)).resolves.toEqual({ outcome: "replay_or_in_progress" });
    await expect(claimVerifiedDisputeAiArchiveAlert({} as Database, verified)).resolves.toEqual({ outcome: "payload_conflict" });
  });
});
