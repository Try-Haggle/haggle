import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateDisputeAiAuditArchiveAlert, getDisputeAiAuditArchiveAlertDeliveryState,
  getDisputeAiAuditArchiveAlertPolicyStatus, resolveDisputeAiAuditArchiveAlertConfigFromEnv,
  sendDisputeAiAuditArchiveAlert,
} from "../services/dispute-ai-audit-archive-alert.service.js";

const health = { status: "critical" as const, pending: 2, processing: 1, failed: 1, deadLetter: 1,
  staleProcessing: 1, retryReady: 1, overdueUnfinished: 1, unfinishedMaxAgeMinutes: 15,
  oldestUnfinishedAgeSeconds: 900, recordedAt: "2026-07-12T00:00:00.000Z" };
const config = { url: "https://ops.example/alerts", secret: "ai-archive-alert-secret", timeoutMs: 5000,
  cooldownMinutes: 15, staleThreshold: 1, retryReadyThreshold: 5, deadLetterThreshold: 1,
  overdueUnfinishedThreshold: 1, discoveryUnresolvedThreshold: 1, discoveryTooLargeThreshold: 1,
  allowInsecureHttp: false, allowPrivateNetwork: false };
const discoveryHealth = { status: "attention" as const, open: 1, retryRequested: 0, unresolved: 1,
  invalidChain: 1, tooLarge: 0, unsealed: 0, resolvedLast24h: 0, oldestOpenAgeSeconds: 60,
  recordedAt: "2026-07-12T00:00:00.000Z" };
const deliveryId = `health_${"a".repeat(64)}`;

describe("dispute AI audit archive alerts", () => {
  afterEach(() => { for (const key of Object.keys(process.env).filter((key) => key.startsWith("DISPUTE_AI_AUDIT_ARCHIVE_ALERT_"))) delete process.env[key]; });

  it("classifies dead letters as critical and stale leases as warning", () => {
    expect(evaluateDisputeAiAuditArchiveAlert(health, config)).toEqual({ wouldAlert: true, severity: "critical",
      reasons: ["ai_audit_archive_dead_letter", "ai_audit_archive_stale_processing", "ai_audit_archive_unfinished_too_old"] });
    expect(evaluateDisputeAiAuditArchiveAlert({ ...health, deadLetter: 0, overdueUnfinished: 0 }, config))
      .toMatchObject({ severity: "warning", reasons: ["ai_audit_archive_stale_processing"] });
  });

  it("alerts independently on retry-ready and overdue backlogs", () => {
    expect(evaluateDisputeAiAuditArchiveAlert({ ...health, deadLetter: 0, staleProcessing: 0, retryReady: 5, overdueUnfinished: 0 }, config))
      .toMatchObject({ reasons: ["ai_audit_archive_retry_ready_backlog"] });
    expect(evaluateDisputeAiAuditArchiveAlert({ ...health, deadLetter: 0, staleProcessing: 0, retryReady: 0 }, config))
      .toMatchObject({ reasons: ["ai_audit_archive_unfinished_too_old"] });
  });

  it("alerts on unresolved discovery failures and escalates oversized chains", () => {
    const healthyArchive = { ...health, status: "healthy" as const, deadLetter: 0, staleProcessing: 0,
      retryReady: 0, overdueUnfinished: 0 };
    expect(evaluateDisputeAiAuditArchiveAlert(healthyArchive, config, discoveryHealth))
      .toMatchObject({ severity: "warning", reasons: ["ai_audit_discovery_failure_unresolved"] });
    expect(evaluateDisputeAiAuditArchiveAlert(healthyArchive, config,
      { ...discoveryHealth, status: "critical", tooLarge: 1 }))
      .toMatchObject({ severity: "critical", reasons: ["ai_audit_discovery_failure_unresolved", "ai_audit_discovery_failure_too_large"] });
  });

  it("sends an HMAC-signed aggregate payload without archive identifiers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    await expect(sendDisputeAiAuditArchiveAlert(health, evaluateDisputeAiAuditArchiveAlert(health, config),
      { config, deliveryId, fetchImpl: fetchMock, now: new Date(health.recordedAt), discoveryHealth })).resolves.toMatchObject({ status: "delivered" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({ "x-haggle-alert-type": "dispute_ai_audit_archive.health",
      "x-haggle-alert-delivery-id": deliveryId, "x-haggle-alert-signature": expect.stringMatching(/^sha256=[0-9a-f]{64}$/) });
    expect(String(request.body)).not.toMatch(/dispute_id|archive_id|archive_key|payload_sha256|receipt_id/);
    expect(JSON.parse(String(request.body)).discovery_failure_health).toMatchObject({ unresolved: 1, invalidChain: 1 });
  });

  it("reports recovery lifecycle without claim identifiers", async () => {
    const db = { execute: vi.fn().mockResolvedValue([{ last_incident_at: "2026-07-12T00:00:00.000Z", last_recovery_at: "2026-07-12T00:05:00.000Z" }]) } as any;
    await expect(getDisputeAiAuditArchiveAlertDeliveryState(db)).resolves.toEqual({ incidentOpen: false,
      lastIncidentAlertAt: "2026-07-12T00:00:00.000Z", lastRecoveryAlertAt: "2026-07-12T00:05:00.000Z" });
  });

  it("rejects unsafe targets and reports configuration state", async () => {
    await expect(sendDisputeAiAuditArchiveAlert(health, evaluateDisputeAiAuditArchiveAlert(health, config), { config, deliveryId: "invalid" })).rejects.toThrow("invalid dispute AI");
    await expect(sendDisputeAiAuditArchiveAlert(health, evaluateDisputeAiAuditArchiveAlert(health, config),
      { config: { ...config, url: "https://127.0.0.1/alerts" }, deliveryId })).rejects.toThrow("private network");
    expect(getDisputeAiAuditArchiveAlertPolicyStatus().configurationState).toBe("not_configured");
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_URL = config.url;
    expect(getDisputeAiAuditArchiveAlertPolicyStatus().configurationState).toBe("partial");
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET = config.secret;
    expect(resolveDisputeAiAuditArchiveAlertConfigFromEnv()).toMatchObject({ url: config.url });
  });
});
