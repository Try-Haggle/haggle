import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDisputeEvidenceSimilarityReviewHealth } from "../services/dispute-record.service.js";
import {
  evaluateDisputeSimilarityReviewAlert,
  getDisputeSimilarityReviewAlertPolicyStatus,
  resolveDisputeSimilarityReviewAlertConfigFromEnv,
  sendDisputeSimilarityReviewAlert,
} from "../services/dispute-similarity-review-alert.service.js";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

const health = (overrides: Record<string, unknown> = {}) => ({
  status: "healthy" as const,
  pendingReviews: 0,
  overdueSla: 0,
  dueSoon: 0,
  expiredUnresolved: 0,
  oldestPendingAgeSeconds: null,
  recordedAt: "2026-07-12T00:00:00.000Z",
  autoExpiredLast24Hours: 0,
  lastAutoExpiredAt: null,
  ...overrides,
});

describe("dispute similarity review SLA health and alert", () => {
  it("maps aggregate database values without identifiers", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        pending_reviews: 3,
        overdue_sla: 2,
        due_soon: 1,
        expired_unresolved: 0,
        oldest_pending_age_seconds: 1200,
        auto_expired_last_24_hours: 4,
        last_auto_expired_at: "2026-07-11T23:00:00.000Z",
      },
    ]);
    const result = await getDisputeEvidenceSimilarityReviewHealth(
      { execute } as unknown as Database,
      {
        now: new Date("2026-07-12T00:00:00.000Z"),
        slaMinutes: 15,
        dueSoonMinutes: 60,
      },
    );
    expect(result).toMatchObject({
      status: "attention",
      pendingReviews: 3,
      overdueSla: 2,
      dueSoon: 1,
      oldestPendingAgeSeconds: 1200,
      autoExpiredLast24Hours: 4,
      lastAutoExpiredAt: "2026-07-11T23:00:00.000Z",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("marks expired unresolved reviews critical", () => {
    expect(
      evaluateDisputeSimilarityReviewAlert(health({ expiredUnresolved: 1, status: "critical" }), {
        overdueThreshold: 1,
        expiredThreshold: 1,
      }),
    ).toEqual({
      wouldAlert: true,
      severity: "critical",
      reasons: ["similarity_review_expired_unresolved"],
    });
  });

  it("marks SLA overdue reviews warning and healthy queues silent", () => {
    expect(
      evaluateDisputeSimilarityReviewAlert(health({ overdueSla: 2, status: "attention" }), {
        overdueThreshold: 2,
        expiredThreshold: 1,
      }),
    ).toMatchObject({
      wouldAlert: true,
      severity: "warning",
      reasons: ["similarity_review_sla_overdue"],
    });
    expect(
      evaluateDisputeSimilarityReviewAlert(health(), { overdueThreshold: 1, expiredThreshold: 1 })
        .wouldAlert,
    ).toBe(false);
  });

  it("requires a strong secret and safe URL", () => {
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL = "https://ops.example/alerts";
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET = "short";
    expect(() => resolveDisputeSimilarityReviewAlertConfigFromEnv()).toThrow("at least 16");
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET = "strong-alert-secret-value";
    expect(resolveDisputeSimilarityReviewAlertConfigFromEnv()).toMatchObject({
      url: "https://ops.example/alerts",
      slaMinutes: 15,
    });
  });

  it("distinguishes partial, invalid, and valid alert configuration", () => {
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL = "https://ops.example/alerts";
    delete process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET;
    expect(getDisputeSimilarityReviewAlertPolicyStatus()).toMatchObject({
      configured: false,
      configurationStatus: "partial",
    });
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET = "strong-alert-secret-value";
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL = "http://127.0.0.1/alerts";
    expect(getDisputeSimilarityReviewAlertPolicyStatus()).toMatchObject({
      configured: false,
      configurationStatus: "invalid",
    });
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL = "https://ops.example/alerts";
    expect(getDisputeSimilarityReviewAlertPolicyStatus()).toMatchObject({
      configured: true,
      configurationStatus: "valid",
    });
  });

  it("sends a signed aggregate-only alert", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const result = await sendDisputeSimilarityReviewAlert(
      health({
        overdueSla: 1,
        pendingReviews: 1,
        oldestPendingAgeSeconds: 901,
        status: "attention",
      }),
      { wouldAlert: true, severity: "warning", reasons: ["similarity_review_sla_overdue"] },
      {
        config: {
          url: "https://ops.example/alerts",
          secret: "strong-alert-secret-value",
          timeoutMs: 1000,
          cooldownMinutes: 15,
          overdueThreshold: 1,
          expiredThreshold: 1,
          slaMinutes: 15,
          dueSoonMinutes: 60,
          allowInsecureHttp: false,
          allowPrivateNetwork: false,
        },
        fetchImpl: fetchImpl as typeof fetch,
        now: new Date("2026-07-12T00:00:00.000Z"),
      },
    );
    expect(result).toEqual({ status: "delivered", httpStatus: 204 });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-haggle-alert-signature"]).toMatch(
      /^sha256=[a-f0-9]{64}$/,
    );
    expect(String(init.body)).not.toContain("upload_id");
    expect(String(init.body)).not.toContain("storage_path");
  });
});
