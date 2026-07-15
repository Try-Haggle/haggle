import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWebhookClaimHealthAlert } from "../jobs/webhook-claim-health-alert.js";
import {
  findLatestDeliveredWebhookClaimIncident,
  sendWebhookClaimAlert,
} from "../services/webhook-claim-alert.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  getWebhookClaimHealth,
} from "../services/webhook-event-claim.service.js";

vi.mock("../services/webhook-event-claim.service.js", () => ({
  claimWebhookEvent: vi.fn(),
  completeWebhookEvent: vi.fn(),
  failWebhookEvent: vi.fn(),
  getWebhookClaimHealth: vi.fn(),
  webhookPayloadSha256: vi.fn(() => "a".repeat(64)),
}));

vi.mock("../services/webhook-claim-alert.service.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../services/webhook-claim-alert.service.js")>();
  return {
    ...original,
    findLatestDeliveredWebhookClaimIncident: vi.fn(),
    sendWebhookClaimAlert: vi.fn(),
  };
});

const criticalHealth = {
  status: "critical" as const,
  totals: { processing: 1, completed: 5, failed: 0, staleProcessing: 1, retryReady: 0 },
  sources: [
    {
      source: "stripe",
      processing: 1,
      completed: 5,
      failed: 0,
      staleProcessing: 1,
      retryReady: 0,
      maxAttemptCount: 2,
      oldestUnfinishedAgeSeconds: 90,
    },
  ],
  recordedAt: "2026-07-12T00:00:00.000Z",
};

describe("webhook claim health alert job", () => {
  afterEach(() => {
    delete process.env.WEBHOOK_CLAIM_ALERT_URL;
    delete process.env.WEBHOOK_CLAIM_ALERT_SECRET;
    vi.clearAllMocks();
  });

  function configure() {
    process.env.WEBHOOK_CLAIM_ALERT_URL = "https://ops.example/alerts";
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = "ops-alert-secret-with-length";
  }

  it("does not query the database when alert delivery is not configured", async () => {
    await expect(runWebhookClaimHealthAlert({} as Database)).resolves.toEqual({
      status: "skipped",
      reason: "not_configured",
    });
    expect(getWebhookClaimHealth).not.toHaveBeenCalled();
  });

  it("skips healthy claim state without reserving an alert claim", async () => {
    configure();
    vi.mocked(getWebhookClaimHealth).mockResolvedValueOnce({
      ...criticalHealth,
      status: "healthy",
      totals: { processing: 0, completed: 5, failed: 0, staleProcessing: 0, retryReady: 0 },
      sources: [],
    });
    vi.mocked(findLatestDeliveredWebhookClaimIncident).mockResolvedValueOnce(null);
    await expect(runWebhookClaimHealthAlert({} as Database)).resolves.toMatchObject({
      status: "skipped",
      reason: "healthy_no_delivered_incident",
    });
    expect(claimWebhookEvent).not.toHaveBeenCalled();
  });

  it("delivers one recovery for a completed incident and suppresses repeats", async () => {
    configure();
    vi.mocked(getWebhookClaimHealth).mockResolvedValue({
      ...criticalHealth,
      status: "healthy",
      totals: { processing: 0, completed: 6, failed: 0, staleProcessing: 0, retryReady: 0 },
      sources: [],
    });
    vi.mocked(findLatestDeliveredWebhookClaimIncident).mockResolvedValue({
      eventId: `health_${"b".repeat(64)}`,
      completedAt: criticalHealth.recordedAt,
    });
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({
        outcome: "acquired",
        source: "haggle-webhook-claim-alert",
        eventId: `recovery_${"c".repeat(64)}`,
        claimId: "11111111-1111-4111-8111-111111111111",
        attemptCount: 1,
      })
      .mockResolvedValueOnce({
        outcome: "duplicate",
        source: "haggle-webhook-claim-alert",
        eventId: `recovery_${"c".repeat(64)}`,
      });
    vi.mocked(sendWebhookClaimAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 200,
    });
    await expect(runWebhookClaimHealthAlert({} as Database)).resolves.toMatchObject({
      status: "recovered",
      assessment: { severity: "recovery", reasons: ["webhook_claim_recovered"] },
    });
    await expect(runWebhookClaimHealthAlert({} as Database)).resolves.toMatchObject({
      status: "skipped",
      reason: "recovery_already_sent_or_in_progress",
    });
    expect(sendWebhookClaimAlert).toHaveBeenCalledTimes(1);
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
  });

  it("delivers one claimed alert and seals the cooldown claim", async () => {
    configure();
    vi.mocked(getWebhookClaimHealth).mockResolvedValueOnce(criticalHealth);
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "haggle-webhook-claim-alert",
      eventId: "health_1",
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    });
    vi.mocked(sendWebhookClaimAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 200,
    });
    await expect(
      runWebhookClaimHealthAlert({} as Database, { now: new Date("2026-07-12T00:00:00.000Z") }),
    ).resolves.toMatchObject({ status: "delivered" });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
    expect(failWebhookEvent).not.toHaveBeenCalled();
  });

  it("suppresses another server when the cooldown claim already exists", async () => {
    configure();
    vi.mocked(getWebhookClaimHealth).mockResolvedValueOnce(criticalHealth);
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "duplicate",
      source: "haggle-webhook-claim-alert",
      eventId: "health_1",
    });
    await expect(runWebhookClaimHealthAlert({} as Database)).resolves.toMatchObject({
      status: "skipped",
      reason: "cooldown_or_in_progress",
    });
    expect(sendWebhookClaimAlert).not.toHaveBeenCalled();
  });

  it("uses one severity bucket key even when aggregate counts change", async () => {
    configure();
    vi.mocked(getWebhookClaimHealth)
      .mockResolvedValueOnce(criticalHealth)
      .mockResolvedValueOnce({
        ...criticalHealth,
        totals: { ...criticalHealth.totals, processing: 7, staleProcessing: 7 },
      });
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({
        outcome: "duplicate",
        source: "haggle-webhook-claim-alert",
        eventId: "health_1",
      })
      .mockResolvedValueOnce({
        outcome: "duplicate",
        source: "haggle-webhook-claim-alert",
        eventId: "health_1",
      });
    const now = new Date("2026-07-12T00:00:00.000Z");
    await runWebhookClaimHealthAlert({} as Database, { now });
    await runWebhookClaimHealthAlert({} as Database, { now });
    const first = vi.mocked(claimWebhookEvent).mock.calls[0]?.[1];
    const second = vi.mocked(claimWebhookEvent).mock.calls[1]?.[1];
    expect(first?.eventId).toBe(second?.eventId);
    expect(first?.payloadSha256).toBe(second?.payloadSha256);
  });

  it("marks the alert claim failed so a later job can retry", async () => {
    configure();
    vi.mocked(getWebhookClaimHealth).mockResolvedValueOnce(criticalHealth);
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "haggle-webhook-claim-alert",
      eventId: "health_1",
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    });
    vi.mocked(sendWebhookClaimAlert).mockResolvedValueOnce({ status: "failed", httpStatus: 503 });
    await expect(runWebhookClaimHealthAlert({} as Database)).resolves.toMatchObject({
      status: "failed",
    });
    expect(failWebhookEvent).toHaveBeenCalledOnce();
  });
});
