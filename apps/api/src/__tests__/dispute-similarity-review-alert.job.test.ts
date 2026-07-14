import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { runDisputeSimilarityReviewAlert } from "../jobs/dispute-similarity-review-alert.js";
import { getDisputeEvidenceSimilarityReviewHealth } from "../services/dispute-record.service.js";
import { sendDisputeSimilarityReviewAlert } from "../services/dispute-similarity-review-alert.service.js";
import { claimWebhookEvent, completeWebhookEvent, failWebhookEvent } from "../services/webhook-event-claim.service.js";

vi.mock("../services/dispute-record.service.js", () => ({ getDisputeEvidenceSimilarityReviewHealth: vi.fn() }));
vi.mock("../services/dispute-similarity-review-alert.service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/dispute-similarity-review-alert.service.js")>();
  return { ...original, sendDisputeSimilarityReviewAlert: vi.fn() };
});
vi.mock("../services/webhook-event-claim.service.js", () => ({
  claimWebhookEvent: vi.fn(), completeWebhookEvent: vi.fn(), failWebhookEvent: vi.fn(),
  webhookPayloadSha256: vi.fn(() => "a".repeat(64)),
}));

const attention = {
  status: "attention" as const, pendingReviews: 1, overdueSla: 1, dueSoon: 0,
  expiredUnresolved: 0, oldestPendingAgeSeconds: 901, recordedAt: "2026-07-12T00:00:00.000Z",
  autoExpiredLast24Hours: 0, lastAutoExpiredAt: null,
};

describe("dispute similarity review alert job", () => {
  afterEach(() => {
    delete process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL;
    delete process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET;
    vi.clearAllMocks();
  });
  const configure = () => {
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL = "https://ops.example/alerts";
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET = "ops-alert-secret-with-length";
  };

  it("skips when unconfigured or healthy", async () => {
    await expect(runDisputeSimilarityReviewAlert({} as Database)).resolves.toEqual({ status: "skipped", reason: "not_configured" });
    configure();
    vi.mocked(getDisputeEvidenceSimilarityReviewHealth).mockResolvedValueOnce({
      ...attention, status: "healthy", pendingReviews: 0, overdueSla: 0, oldestPendingAgeSeconds: null,
    });
    await expect(runDisputeSimilarityReviewAlert({} as Database)).resolves.toMatchObject({ status: "skipped", reason: "healthy" });
  });

  it("delivers one claimed alert and suppresses a duplicate server", async () => {
    configure();
    vi.mocked(getDisputeEvidenceSimilarityReviewHealth).mockResolvedValue(attention);
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({ outcome: "acquired", source: "haggle-dispute-similarity-review-alert", eventId: "health", claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 })
      .mockResolvedValueOnce({ outcome: "duplicate", source: "haggle-dispute-similarity-review-alert", eventId: "health" });
    vi.mocked(sendDisputeSimilarityReviewAlert).mockResolvedValueOnce({ status: "delivered", httpStatus: 200 });
    await expect(runDisputeSimilarityReviewAlert({} as Database)).resolves.toMatchObject({ status: "delivered" });
    await expect(runDisputeSimilarityReviewAlert({} as Database)).resolves.toMatchObject({ status: "skipped", reason: "cooldown_or_in_progress" });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
    expect(sendDisputeSimilarityReviewAlert).toHaveBeenCalledOnce();
  });

  it("marks failed delivery for retry", async () => {
    configure();
    vi.mocked(getDisputeEvidenceSimilarityReviewHealth).mockResolvedValueOnce(attention);
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "acquired", source: "haggle-dispute-similarity-review-alert", eventId: "health", claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 });
    vi.mocked(sendDisputeSimilarityReviewAlert).mockResolvedValueOnce({ status: "failed", httpStatus: 503 });
    await expect(runDisputeSimilarityReviewAlert({} as Database)).resolves.toMatchObject({ status: "failed" });
    expect(failWebhookEvent).toHaveBeenCalledOnce();
  });
});
