import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { runDisputeSimilarityReviewAuditArchiveAlert } from "../jobs/dispute-similarity-review-audit-archive-alert.js";
import { getDisputeSimilarityReviewAuditArchiveHealth } from "../services/dispute-similarity-review-audit-archive.service.js";
import {
  findLatestDeliveredDisputeSimilarityReviewAuditArchiveIncident,
  sendDisputeSimilarityReviewAuditArchiveAlert,
} from "../services/dispute-similarity-review-audit-archive-alert.service.js";
import { claimWebhookEvent, completeWebhookEvent, failWebhookEvent } from "../services/webhook-event-claim.service.js";

vi.mock("../services/dispute-similarity-review-audit-archive.service.js", () => ({ getDisputeSimilarityReviewAuditArchiveHealth: vi.fn() }));
vi.mock("../services/dispute-similarity-review-audit-archive-alert.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/dispute-similarity-review-audit-archive-alert.service.js")>()),
  findLatestDeliveredDisputeSimilarityReviewAuditArchiveIncident: vi.fn(),
  sendDisputeSimilarityReviewAuditArchiveAlert: vi.fn(),
}));
vi.mock("../services/webhook-event-claim.service.js", () => ({ claimWebhookEvent: vi.fn(), completeWebhookEvent: vi.fn(), failWebhookEvent: vi.fn(), webhookPayloadSha256: vi.fn(() => "a".repeat(64)) }));

const health = { status: "critical" as const, pending: 0, processing: 0, failed: 0, deadLetter: 1, staleProcessing: 0, retryReady: 0, overdueUnfinished: 0, unfinishedMaxAgeMinutes: 15, oldestUnfinishedAgeSeconds: 60, recordedAt: "2026-07-12T00:00:00.000Z" };

describe("similarity review audit archive alert job", () => {
  afterEach(() => {
    delete process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL;
    delete process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET;
    vi.clearAllMocks();
  });
  const configure = () => {
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL = "https://ops.example/alerts";
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET = "similarity-archive-alert-secret";
  };

  it("skips when unconfigured or healthy without a delivered incident", async () => {
    await expect(runDisputeSimilarityReviewAuditArchiveAlert({} as Database)).resolves.toMatchObject({ status: "skipped", reason: "not_configured" });
    configure();
    vi.mocked(getDisputeSimilarityReviewAuditArchiveHealth).mockResolvedValueOnce({ ...health, status: "healthy", deadLetter: 0 });
    vi.mocked(findLatestDeliveredDisputeSimilarityReviewAuditArchiveIncident).mockResolvedValueOnce(null);
    await expect(runDisputeSimilarityReviewAuditArchiveAlert({} as Database)).resolves.toMatchObject({ status: "skipped", reason: "healthy_no_delivered_incident" });
  });

  it("delivers one recovery after a delivered incident and suppresses duplicates", async () => {
    configure();
    vi.mocked(getDisputeSimilarityReviewAuditArchiveHealth).mockResolvedValue({ ...health, status: "healthy", deadLetter: 0 });
    vi.mocked(findLatestDeliveredDisputeSimilarityReviewAuditArchiveIncident).mockResolvedValue({ eventId: `health_${"b".repeat(64)}`, completedAt: health.recordedAt });
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({ outcome: "acquired", source: "x", eventId: "x", claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 })
      .mockResolvedValueOnce({ outcome: "duplicate", source: "x", eventId: "x" });
    vi.mocked(sendDisputeSimilarityReviewAuditArchiveAlert).mockResolvedValueOnce({ status: "delivered", httpStatus: 200 });
    await expect(runDisputeSimilarityReviewAuditArchiveAlert({} as Database)).resolves.toMatchObject({
      status: "recovered", assessment: { severity: "recovery", reasons: ["similarity_audit_archive_recovered"] },
    });
    await expect(runDisputeSimilarityReviewAuditArchiveAlert({} as Database)).resolves.toMatchObject({ reason: "recovery_already_sent_or_in_progress" });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
    expect(sendDisputeSimilarityReviewAuditArchiveAlert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "healthy" }),
      expect.objectContaining({ severity: "recovery" }),
      expect.anything(),
    );
  });

  it("leaves a failed recovery claim on the shared backoff path", async () => {
    configure();
    vi.mocked(getDisputeSimilarityReviewAuditArchiveHealth).mockResolvedValue({ ...health, status: "healthy", deadLetter: 0 });
    vi.mocked(findLatestDeliveredDisputeSimilarityReviewAuditArchiveIncident).mockResolvedValue({ eventId: `health_${"d".repeat(64)}`, completedAt: health.recordedAt });
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "acquired", source: "x", eventId: "x", claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 });
    vi.mocked(sendDisputeSimilarityReviewAuditArchiveAlert).mockResolvedValueOnce({ status: "failed", httpStatus: 503 });
    await expect(runDisputeSimilarityReviewAuditArchiveAlert({} as Database)).resolves.toMatchObject({ status: "failed", phase: "recovery" });
    expect(failWebhookEvent).toHaveBeenCalledOnce();
    expect(completeWebhookEvent).not.toHaveBeenCalled();
  });

  it("delivers once and suppresses a cooldown duplicate", async () => {
    configure();
    vi.mocked(getDisputeSimilarityReviewAuditArchiveHealth).mockResolvedValue(health);
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({ outcome: "acquired", source: "x", eventId: "x", claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 })
      .mockResolvedValueOnce({ outcome: "duplicate", source: "x", eventId: "x" });
    vi.mocked(sendDisputeSimilarityReviewAuditArchiveAlert).mockResolvedValueOnce({ status: "delivered", httpStatus: 200 });
    await expect(runDisputeSimilarityReviewAuditArchiveAlert({} as Database)).resolves.toMatchObject({ status: "delivered" });
    await expect(runDisputeSimilarityReviewAuditArchiveAlert({} as Database)).resolves.toMatchObject({ reason: "cooldown_or_in_progress" });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
  });
});
