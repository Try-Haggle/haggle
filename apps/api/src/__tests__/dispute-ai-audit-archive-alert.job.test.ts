import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { runDisputeAiAuditArchiveAlert } from "../jobs/dispute-ai-audit-archive-alert.js";
import { getDisputeAiAuditArchiveHealth, getDisputeAiAuditDiscoveryFailureHealth } from "../services/dispute-ai-audit-archive.service.js";
import { findLatestDeliveredDisputeAiAuditArchiveIncident, sendDisputeAiAuditArchiveAlert } from "../services/dispute-ai-audit-archive-alert.service.js";
import { claimWebhookEvent, completeWebhookEvent, failWebhookEvent } from "../services/webhook-event-claim.service.js";

vi.mock("../services/dispute-ai-audit-archive.service.js", () => ({
  getDisputeAiAuditArchiveHealth: vi.fn(), getDisputeAiAuditDiscoveryFailureHealth: vi.fn(),
}));
vi.mock("../services/dispute-ai-audit-archive-alert.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/dispute-ai-audit-archive-alert.service.js")>()),
  findLatestDeliveredDisputeAiAuditArchiveIncident: vi.fn(), sendDisputeAiAuditArchiveAlert: vi.fn(),
}));
vi.mock("../services/webhook-event-claim.service.js", () => ({ claimWebhookEvent: vi.fn(), completeWebhookEvent: vi.fn(), failWebhookEvent: vi.fn(), webhookPayloadSha256: vi.fn(() => "a".repeat(64)) }));
const health = { status: "critical" as const, pending: 0, processing: 0, failed: 0, deadLetter: 1,
  staleProcessing: 0, retryReady: 0, overdueUnfinished: 0, unfinishedMaxAgeMinutes: 15,
  oldestUnfinishedAgeSeconds: 60, recordedAt: "2026-07-12T00:00:00.000Z" };

describe("dispute AI audit archive alert job", () => {
  afterEach(() => { delete process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_URL; delete process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET; vi.clearAllMocks(); });
  const configure = () => { process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_URL = "https://ops.example/alerts"; process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET = "ai-archive-alert-secret";
    vi.mocked(getDisputeAiAuditDiscoveryFailureHealth).mockResolvedValue({ status: "healthy", open: 0, retryRequested: 0,
      unresolved: 0, invalidChain: 0, tooLarge: 0, unsealed: 0, resolvedLast24h: 0,
      oldestOpenAgeSeconds: null, recordedAt: health.recordedAt }); };

  it("skips unconfigured and healthy-without-incident runs", async () => {
    await expect(runDisputeAiAuditArchiveAlert({} as Database)).resolves.toMatchObject({ reason: "not_configured" });
    configure(); vi.mocked(getDisputeAiAuditArchiveHealth).mockResolvedValueOnce({ ...health, status: "healthy", deadLetter: 0 });
    vi.mocked(findLatestDeliveredDisputeAiAuditArchiveIncident).mockResolvedValueOnce(null);
    await expect(runDisputeAiAuditArchiveAlert({} as Database)).resolves.toMatchObject({ reason: "healthy_no_delivered_incident" });
  });

  it("delivers once and suppresses a cooldown duplicate", async () => {
    configure(); vi.mocked(getDisputeAiAuditArchiveHealth).mockResolvedValue(health);
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "acquired", source: "x", eventId: "x", claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 }).mockResolvedValueOnce({ outcome: "duplicate", source: "x", eventId: "x" });
    vi.mocked(sendDisputeAiAuditArchiveAlert).mockResolvedValueOnce({ status: "delivered", httpStatus: 200 });
    await expect(runDisputeAiAuditArchiveAlert({} as Database)).resolves.toMatchObject({ status: "delivered" });
    await expect(runDisputeAiAuditArchiveAlert({} as Database)).resolves.toMatchObject({ reason: "cooldown_or_in_progress" });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
  });

  it("delivers a warning when archive delivery is healthy but discovery is unresolved", async () => {
    configure();
    vi.mocked(getDisputeAiAuditArchiveHealth).mockResolvedValue({ ...health, status: "healthy", deadLetter: 0 });
    vi.mocked(getDisputeAiAuditDiscoveryFailureHealth).mockResolvedValue({ status: "attention", open: 1, retryRequested: 0,
      unresolved: 1, invalidChain: 1, tooLarge: 0, unsealed: 0, resolvedLast24h: 0,
      oldestOpenAgeSeconds: 60, recordedAt: health.recordedAt });
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "acquired", source: "x", eventId: "x",
      claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 });
    vi.mocked(sendDisputeAiAuditArchiveAlert).mockResolvedValueOnce({ status: "delivered", httpStatus: 200 });
    await expect(runDisputeAiAuditArchiveAlert({} as Database)).resolves.toMatchObject({ status: "delivered",
      assessment: { severity: "warning", reasons: ["ai_audit_discovery_failure_unresolved"] } });
  });

  it("delivers one recovery and suppresses duplicates", async () => {
    configure(); vi.mocked(getDisputeAiAuditArchiveHealth).mockResolvedValue({ ...health, status: "healthy", deadLetter: 0 });
    vi.mocked(findLatestDeliveredDisputeAiAuditArchiveIncident).mockResolvedValue({ eventId: `health_${"b".repeat(64)}`, completedAt: health.recordedAt });
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "acquired", source: "x", eventId: "x", claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 }).mockResolvedValueOnce({ outcome: "duplicate", source: "x", eventId: "x" });
    vi.mocked(sendDisputeAiAuditArchiveAlert).mockResolvedValueOnce({ status: "delivered", httpStatus: 200 });
    await expect(runDisputeAiAuditArchiveAlert({} as Database)).resolves.toMatchObject({ status: "recovered", assessment: { severity: "recovery" } });
    await expect(runDisputeAiAuditArchiveAlert({} as Database)).resolves.toMatchObject({ reason: "recovery_already_sent_or_in_progress" });
  });

  it("leaves failed recovery on the shared retry path", async () => {
    configure(); vi.mocked(getDisputeAiAuditArchiveHealth).mockResolvedValue({ ...health, status: "healthy", deadLetter: 0 });
    vi.mocked(findLatestDeliveredDisputeAiAuditArchiveIncident).mockResolvedValue({ eventId: `health_${"d".repeat(64)}`, completedAt: health.recordedAt });
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "acquired", source: "x", eventId: "x", claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 });
    vi.mocked(sendDisputeAiAuditArchiveAlert).mockResolvedValueOnce({ status: "failed", httpStatus: 503 });
    await expect(runDisputeAiAuditArchiveAlert({} as Database)).resolves.toMatchObject({ status: "failed", phase: "recovery" });
    expect(failWebhookEvent).toHaveBeenCalledOnce();
  });
});
