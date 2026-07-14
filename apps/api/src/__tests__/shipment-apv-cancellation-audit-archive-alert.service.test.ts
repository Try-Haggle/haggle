import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateShipmentApvCancellationAuditArchiveAlert, getShipmentApvCancellationAuditArchiveAlertPolicyStatus, resolveShipmentApvCancellationAuditArchiveAlertConfigFromEnv, sendShipmentApvCancellationAuditArchiveAlert } from "../services/shipment-apv-payout-cancellation-audit-archive-alert.service.js";

const health = { status: "critical" as const, pending: 2, processing: 1, failed: 1, deadLetter: 1, staleProcessing: 1, retryReady: 1, overdueUnfinished: 1, unfinishedMaxAgeMinutes: 15, oldestUnfinishedAgeSeconds: 900, recordedAt: "2026-07-12T00:00:00.000Z" };
const config = { url: "https://ops.example/alerts", secret: "archive-alert-secret-long", timeoutMs: 5000, cooldownMinutes: 15, staleThreshold: 1, retryReadyThreshold: 5, deadLetterThreshold: 1, overdueUnfinishedThreshold: 1, allowInsecureHttp: false, allowPrivateNetwork: false };

describe("APV cancellation audit archive alerts", () => {
  afterEach(() => { delete process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL; delete process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_SECRET; });

  it("classifies dead letters as critical and stale leases as warning", () => {
    expect(evaluateShipmentApvCancellationAuditArchiveAlert(health, config)).toEqual({ wouldAlert: true, severity: "critical", reasons: ["audit_archive_dead_letter", "audit_archive_stale_processing", "audit_archive_unfinished_too_old"] });
    expect(evaluateShipmentApvCancellationAuditArchiveAlert({ ...health, deadLetter: 0, overdueUnfinished: 0 }, config)).toMatchObject({ wouldAlert: true, severity: "warning", reasons: ["audit_archive_stale_processing"] });
  });

  it("alerts on a retry-ready backlog at its independent threshold", () => {
    expect(evaluateShipmentApvCancellationAuditArchiveAlert({ ...health, deadLetter: 0, staleProcessing: 0, retryReady: 5, overdueUnfinished: 0 }, config))
      .toMatchObject({ wouldAlert: true, severity: "warning", reasons: ["audit_archive_retry_ready_backlog"] });
  });

  it("alerts when pending delivery exceeds the archive SLA", () => {
    expect(evaluateShipmentApvCancellationAuditArchiveAlert({ ...health, deadLetter: 0, staleProcessing: 0, retryReady: 0 }, config))
      .toMatchObject({ wouldAlert: true, severity: "warning", reasons: ["audit_archive_unfinished_too_old"] });
  });

  it("sends an HMAC-signed aggregate payload without archive identifiers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    await expect(sendShipmentApvCancellationAuditArchiveAlert(health, evaluateShipmentApvCancellationAuditArchiveAlert(health, config), { config, fetchImpl: fetchMock, now: new Date(health.recordedAt) })).resolves.toMatchObject({ status: "delivered" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({ "x-haggle-alert-signature": expect.stringMatching(/^sha256=[0-9a-f]{64}$/) });
    expect(String(request.body)).not.toMatch(/request_id|archive_key|receipt_id/);
  });

  it("rejects unsafe targets and short secrets", async () => {
    await expect(sendShipmentApvCancellationAuditArchiveAlert(health, evaluateShipmentApvCancellationAuditArchiveAlert(health, config), { config: { ...config, url: "https://127.0.0.1/alerts" } })).rejects.toThrow("private network");
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL = config.url;
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_SECRET = "short";
    expect(() => resolveShipmentApvCancellationAuditArchiveAlertConfigFromEnv()).toThrow("at least 16 characters");
  });

  it("distinguishes absent, partial, invalid, and valid alert configuration", () => {
    expect(getShipmentApvCancellationAuditArchiveAlertPolicyStatus().configurationState).toBe("not_configured");
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL = "https://ops.example/alerts";
    expect(getShipmentApvCancellationAuditArchiveAlertPolicyStatus().configurationState).toBe("partial");
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_SECRET = config.secret;
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL = "https://127.0.0.1/alerts";
    expect(getShipmentApvCancellationAuditArchiveAlertPolicyStatus().configurationState).toBe("invalid");
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL = config.url;
    expect(getShipmentApvCancellationAuditArchiveAlertPolicyStatus()).toMatchObject({ configured: true, configurationState: "valid" });
  });
});
