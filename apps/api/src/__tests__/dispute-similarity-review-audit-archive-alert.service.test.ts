import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateDisputeSimilarityReviewAuditArchiveAlert,
  findLatestDeliveredDisputeSimilarityReviewAuditArchiveIncident,
  getDisputeSimilarityReviewAuditArchiveAlertDeliveryState,
  getDisputeSimilarityReviewAuditArchiveAlertPolicyStatus,
  resolveDisputeSimilarityReviewAuditArchiveAlertConfigFromEnv,
  sendDisputeSimilarityReviewAuditArchiveAlert,
} from "../services/dispute-similarity-review-audit-archive-alert.service.js";

const health = { status: "critical" as const, pending: 2, processing: 1, failed: 1, deadLetter: 1, staleProcessing: 1, retryReady: 1, overdueUnfinished: 1, unfinishedMaxAgeMinutes: 15, oldestUnfinishedAgeSeconds: 900, recordedAt: "2026-07-12T00:00:00.000Z" };
const config = { url: "https://ops.example/alerts", secret: "similarity-archive-alert-secret", timeoutMs: 5000, cooldownMinutes: 15, staleThreshold: 1, retryReadyThreshold: 5, deadLetterThreshold: 1, overdueUnfinishedThreshold: 1, allowInsecureHttp: false, allowPrivateNetwork: false };
const deliveryId = `health_${"a".repeat(64)}`;

describe("similarity review audit archive alerts", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env).filter((key) => key.startsWith("DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_"))) delete process.env[key];
  });

  it("classifies dead letters as critical and stale leases as warning", () => {
    expect(evaluateDisputeSimilarityReviewAuditArchiveAlert(health, config)).toEqual({
      wouldAlert: true, severity: "critical",
      reasons: ["similarity_audit_archive_dead_letter", "similarity_audit_archive_stale_processing", "similarity_audit_archive_unfinished_too_old"],
    });
    expect(evaluateDisputeSimilarityReviewAuditArchiveAlert({ ...health, deadLetter: 0, overdueUnfinished: 0 }, config))
      .toMatchObject({ wouldAlert: true, severity: "warning", reasons: ["similarity_audit_archive_stale_processing"] });
  });

  it("alerts independently on retry-ready and overdue backlogs", () => {
    expect(evaluateDisputeSimilarityReviewAuditArchiveAlert({ ...health, deadLetter: 0, staleProcessing: 0, retryReady: 5, overdueUnfinished: 0 }, config))
      .toMatchObject({ reasons: ["similarity_audit_archive_retry_ready_backlog"] });
    expect(evaluateDisputeSimilarityReviewAuditArchiveAlert({ ...health, deadLetter: 0, staleProcessing: 0, retryReady: 0 }, config))
      .toMatchObject({ reasons: ["similarity_audit_archive_unfinished_too_old"] });
  });

  it("sends an HMAC-signed aggregate payload without archive identifiers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    await expect(sendDisputeSimilarityReviewAuditArchiveAlert(health, evaluateDisputeSimilarityReviewAuditArchiveAlert(health, config), { config, deliveryId, fetchImpl: fetchMock, now: new Date(health.recordedAt) }))
      .resolves.toMatchObject({ status: "delivered" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      "x-haggle-alert-type": "dispute_similarity_review_audit_archive.health",
      "x-haggle-alert-delivery-id": deliveryId,
      "x-haggle-alert-signature": expect.stringMatching(/^sha256=[0-9a-f]{64}$/),
    });
    expect(String(request.body)).not.toMatch(/event_id|archive_key|payload_sha256|receipt_id/);
    expect(JSON.parse(String(request.body))).toMatchObject({ state: "firing", delivery_id: deliveryId });
  });

  it("marks recovery payloads and derives an identifier-free delivery state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    await sendDisputeSimilarityReviewAuditArchiveAlert(
      { ...health, status: "healthy", deadLetter: 0, staleProcessing: 0, failed: 0, overdueUnfinished: 0 },
      { wouldAlert: true, severity: "recovery", reasons: ["similarity_audit_archive_recovered"] },
      { config, deliveryId: `recovery_${"b".repeat(64)}`, fetchImpl: fetchMock, now: new Date(health.recordedAt) },
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
      state: "recovered", severity: "recovery", reasons: ["similarity_audit_archive_recovered"],
    });
    const db = { execute: vi.fn().mockResolvedValueOnce([{
      last_incident_at: "2026-07-12T00:00:00.000Z", last_recovery_at: "2026-07-12T00:05:00.000Z",
    }]).mockResolvedValueOnce([{
      event_id: `health_${"c".repeat(64)}`, completed_at: "2026-07-12T00:00:00.000Z",
    }]) } as any;
    await expect(getDisputeSimilarityReviewAuditArchiveAlertDeliveryState(db)).resolves.toEqual({
      incidentOpen: false,
      lastIncidentAlertAt: "2026-07-12T00:00:00.000Z",
      lastRecoveryAlertAt: "2026-07-12T00:05:00.000Z",
    });
    await expect(findLatestDeliveredDisputeSimilarityReviewAuditArchiveIncident(db)).resolves.toMatchObject({
      eventId: `health_${"c".repeat(64)}`,
    });
  });

  it("rejects unsafe targets and reports configuration state", async () => {
    await expect(sendDisputeSimilarityReviewAuditArchiveAlert(health, evaluateDisputeSimilarityReviewAuditArchiveAlert(health, config), { config, deliveryId: "invalid" })).rejects.toThrow("invalid similarity review audit archive alert delivery id");
    await expect(sendDisputeSimilarityReviewAuditArchiveAlert(health, evaluateDisputeSimilarityReviewAuditArchiveAlert(health, config), { config: { ...config, url: "https://127.0.0.1/alerts" }, deliveryId })).rejects.toThrow("private network");
    expect(getDisputeSimilarityReviewAuditArchiveAlertPolicyStatus().configurationState).toBe("not_configured");
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL = config.url;
    expect(getDisputeSimilarityReviewAuditArchiveAlertPolicyStatus().configurationState).toBe("partial");
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET = config.secret;
    expect(resolveDisputeSimilarityReviewAuditArchiveAlertConfigFromEnv()).toMatchObject({ url: config.url });
    expect(getDisputeSimilarityReviewAuditArchiveAlertPolicyStatus()).toMatchObject({ configured: true, configurationState: "valid" });
  });
});
