import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { runShipmentApvCancellationAuditArchiveAlert } from "../jobs/shipment-apv-cancellation-audit-archive-alert.js";
import { getShipmentApvCancellationAuditArchiveHealth } from "../services/shipment-apv-payout-cancellation-audit-archive.service.js";
import { sendShipmentApvCancellationAuditArchiveAlert } from "../services/shipment-apv-payout-cancellation-audit-archive-alert.service.js";
import { claimWebhookEvent, completeWebhookEvent } from "../services/webhook-event-claim.service.js";

vi.mock("../services/shipment-apv-payout-cancellation-audit-archive.service.js", () => ({ getShipmentApvCancellationAuditArchiveHealth: vi.fn() }));
vi.mock("../services/shipment-apv-payout-cancellation-audit-archive-alert.service.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../services/shipment-apv-payout-cancellation-audit-archive-alert.service.js")>()), sendShipmentApvCancellationAuditArchiveAlert: vi.fn() }));
vi.mock("../services/webhook-event-claim.service.js", () => ({ claimWebhookEvent: vi.fn(), completeWebhookEvent: vi.fn(), failWebhookEvent: vi.fn(), webhookPayloadSha256: vi.fn(() => "a".repeat(64)) }));

const health = { status: "critical" as const, pending: 0, processing: 0, failed: 0, deadLetter: 1, staleProcessing: 0, retryReady: 0, overdueUnfinished: 0, unfinishedMaxAgeMinutes: 15, oldestUnfinishedAgeSeconds: 60, recordedAt: "2026-07-12T00:00:00.000Z" };
describe("APV cancellation audit archive alert job", () => {
  afterEach(() => { delete process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL; delete process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_SECRET; vi.clearAllMocks(); });
  const configure = () => { process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL = "https://ops.example/alerts"; process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_SECRET = "archive-alert-secret-long"; };
  it("skips when unconfigured or healthy", async () => {
    await expect(runShipmentApvCancellationAuditArchiveAlert({} as Database)).resolves.toMatchObject({ status: "skipped", reason: "not_configured" });
    configure(); vi.mocked(getShipmentApvCancellationAuditArchiveHealth).mockResolvedValueOnce({ ...health, status: "healthy", deadLetter: 0 });
    await expect(runShipmentApvCancellationAuditArchiveAlert({} as Database)).resolves.toMatchObject({ status: "skipped", reason: "healthy" });
  });
  it("delivers once and suppresses the cooldown duplicate", async () => {
    configure(); vi.mocked(getShipmentApvCancellationAuditArchiveHealth).mockResolvedValue(health);
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "acquired", source: "x", eventId: "x", claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 }).mockResolvedValueOnce({ outcome: "duplicate", source: "x", eventId: "x" });
    vi.mocked(sendShipmentApvCancellationAuditArchiveAlert).mockResolvedValueOnce({ status: "delivered", httpStatus: 200 });
    await expect(runShipmentApvCancellationAuditArchiveAlert({} as Database)).resolves.toMatchObject({ status: "delivered" });
    await expect(runShipmentApvCancellationAuditArchiveAlert({} as Database)).resolves.toMatchObject({ reason: "cooldown_or_in_progress" });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
  });
});
