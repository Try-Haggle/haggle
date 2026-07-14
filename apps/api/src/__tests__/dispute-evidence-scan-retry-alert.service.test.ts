import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import {
  createDisputeEvidenceScanRetryAlertSnapshot,
  evaluateDisputeEvidenceScanRetryAlert,
  getDisputeEvidenceScanRetryAlertSenderHealth,
  getDisputeEvidenceScanRetryAlertPolicyStatus,
  resolveDisputeEvidenceScanRetryAlertConfigFromEnv,
  sendDisputeEvidenceScanRetryAlert,
  type DisputeEvidenceScanRetryAlertConfig,
  type DisputeEvidenceScanRetryAlertSnapshotRetentionHealth,
  type DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth,
} from "../services/dispute-evidence-scan-retry-alert.service.js";
import {
  getDisputeEvidenceScanRetryAlertReceiverPolicyStatus,
  resolveDisputeEvidenceScanRetryAlertReceiverSecretsFromEnv,
  verifyDisputeEvidenceScanRetryAlert,
} from "../services/dispute-evidence-scan-retry-alert-verifier.service.js";
import { signWebhookClaimAlertPayload } from
  "../services/webhook-claim-alert.service.js";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

const config: DisputeEvidenceScanRetryAlertConfig = {
  url: "https://ops.example/scan-retry",
  secret: "strong-scan-retry-alert-secret",
  timeoutMs: 1_000,
  cooldownMinutes: 15,
  retryReadyThreshold: 10,
  staleThreshold: 1,
  exhaustedThreshold: 1,
  expiredThreshold: 1,
  retentionBlockedThreshold: 1,
  allowInsecureHttp: false,
  allowPrivateNetwork: false,
};

const health = (overrides: Record<string, number> = {}) => ({
  schemaVersion: "dispute-evidence-scan-retry-health-v1" as const,
  status: "healthy" as const,
  job: { enabled: false, cronEnabled: false },
  scanner: {
    schemaVersion: "dispute-evidence-scanner-readiness-v1" as const,
    configurationState: "not_configured" as const,
    configured: false,
    authenticated: false,
    transport: { httpsRequired: true, insecureHttpOverride: false },
    network: { privateNetworkBlocked: true, redirectsBlocked: true,
      dnsResolutionValidated: true, dnsConnectionPinned: true },
    limits: { timeoutMs: 15_000, maxResponseBytes: 16_384,
      maxFilenameChars: 160, maxResolvedAddresses: 16 },
    containsUrl: false,
    containsToken: false,
  },
  policy: { batchSize: 10, maxAttempts: 5, leaseSeconds: 60,
    baseBackoffSeconds: 30, maxBackoffSeconds: 3_600 },
  totals: {
    quarantined: 0, pending: 0, failed: 0, processing: 0,
    staleProcessing: 0, retryReady: 0, exhausted: 0,
    expiredQuarantined: 0,
    ...overrides,
  },
  oldestUnresolvedAgeSeconds: null,
  containsIdentifiers: false,
  containsStoragePaths: false,
  containsLeaseTokens: false,
  observedAt: "2026-07-14T08:30:00.000Z",
});

const circuit = (state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED") => ({
  schemaVersion: "dispute-evidence-scanner-circuit-health-v1" as const,
  status: state === "CLOSED" ? "healthy" as const : "attention" as const,
  state,
  consecutiveFailures: state === "CLOSED" ? 0 : 3,
  activePermits: state === "HALF_OPEN" ? 1 : 0,
  policy: { failureThreshold: 3, openSeconds: 60,
    permitLeaseSeconds: 30, maxConcurrent: 4 },
  nextProbeAt: state === "OPEN" ? "2026-07-14T08:31:00.000Z" : null,
  probeExpiresAt: state === "HALF_OPEN"
    ? "2026-07-14T08:30:30.000Z" : null,
  lastSuccessAt: null,
  lastFailureAt: state === "CLOSED" ? null : "2026-07-14T08:30:00.000Z",
  containsPermitTokens: false, containsCircuitKey: false,
  observedAt: "2026-07-14T08:30:00.000Z",
});

const retention = (blockedExpired = 0):
DisputeEvidenceScanRetryAlertSnapshotRetentionHealth => ({
  status: blockedExpired ? "attention" : "healthy",
  eligibleExpired: 0,
  blockedExpired,
  oldestBlockedExpiredAgeSeconds: blockedExpired ? 60 : null,
  policy: { retentionDays: 30, batchSize: 100,
    jobEnabled: true, cronEnabled: true },
  containsIdentifiers: false,
  recordedAt: "2026-07-14T08:30:00.000Z",
});

const retentionJob = (
  overrides: Partial<DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth>
    = {},
): DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth => ({
  status: "healthy",
  lastRunStatus: "SUCCEEDED",
  overdue: false,
  leaseStale: false,
  firstObservedAt: "2026-07-13T08:30:00.000Z",
  lastStartedAt: "2026-07-14T08:29:00.000Z",
  lastSucceededAt: "2026-07-14T08:30:00.000Z",
  lastFailedAt: null,
  lastDeletedSnapshots: 0,
  lastFailureCode: null,
  policy: { jobEnabled: true, cronEnabled: true, intervalSeconds: 86_400,
    leaseSeconds: 900, maxStartDelaySeconds: 93_600 },
  containsIdentifiers: false,
  recordedAt: "2026-07-14T08:30:00.000Z",
  ...overrides,
});

describe("dispute evidence scan retry alert", () => {
  it("classifies backlog and terminal failures without identifiers", () => {
    expect(evaluateDisputeEvidenceScanRetryAlert(
      health({ retryReady: 10 }), circuit(), config, retention(), retentionJob(),
    )).toEqual({
      wouldAlert: true,
      severity: "warning",
      reasons: ["scan_retry_ready_backlog"],
    });
    expect(evaluateDisputeEvidenceScanRetryAlert(
      health({ staleProcessing: 1, exhausted: 1 }), circuit(), config,
      retention(), retentionJob(),
    )).toEqual({
      wouldAlert: true,
      severity: "critical",
      reasons: ["scan_retry_exhausted", "scan_retry_stale_processing"],
    });
    expect(evaluateDisputeEvidenceScanRetryAlert(
      health(), circuit(), config, retention(), retentionJob(),
    ))
      .toMatchObject({ wouldAlert: false, severity: null, reasons: [] });
    expect(evaluateDisputeEvidenceScanRetryAlert(
      health(), circuit("OPEN"), config, retention(), retentionJob(),
    )).toEqual({
      wouldAlert: true,
      severity: "critical",
      reasons: ["scanner_circuit_open"],
    });
    expect(evaluateDisputeEvidenceScanRetryAlert(
      health(), circuit("HALF_OPEN"), config, retention(), retentionJob(),
    )).toEqual({
      wouldAlert: true,
      severity: "warning",
      reasons: ["scanner_circuit_half_open"],
    });
  });

  it("classifies blocked retention and active job failures independently", () => {
    expect(evaluateDisputeEvidenceScanRetryAlert(
      health(), circuit(), config, retention(1), retentionJob({
        status: "critical", lastRunStatus: "STALE_RUNNING", leaseStale: true,
      }),
    )).toEqual({
      wouldAlert: true,
      severity: "critical",
      reasons: ["alert_snapshot_retention_job_stale",
        "alert_snapshot_retention_blocked"],
    });
    expect(evaluateDisputeEvidenceScanRetryAlert(
      health(), circuit(), config, retention(), retentionJob({
        status: "attention", lastRunStatus: "FAILED", overdue: true,
      }),
    )).toEqual({
      wouldAlert: true,
      severity: "warning",
      reasons: ["alert_snapshot_retention_job_failed",
        "alert_snapshot_retention_job_overdue"],
    });
    expect(evaluateDisputeEvidenceScanRetryAlert(
      health(), circuit(), config, retention(), retentionJob({
        status: "inactive", lastRunStatus: "FAILED",
        policy: { jobEnabled: false, cronEnabled: false,
          intervalSeconds: 86_400, leaseSeconds: 900,
          maxStartDelaySeconds: 93_600 },
      }),
    )).toMatchObject({ wouldAlert: false, severity: null, reasons: [] });
    expect(evaluateDisputeEvidenceScanRetryAlert(
      health(), circuit(), config, retention(), retentionJob({
        status: "attention", lastRunStatus: "FAILED", overdue: true,
        policy: { jobEnabled: false, cronEnabled: false,
          intervalSeconds: 86_400, leaseSeconds: 900,
          maxStartDelaySeconds: 93_600 },
      }),
    )).toMatchObject({ wouldAlert: false, severity: null, reasons: [] });
  });

  it("reports aggregate-only sender delivery failures and stale claims", async () => {
    const claimRow = {
      processing: 1, completed: 2, failed: 3, staleProcessing: 1,
      retryReady: 2, maxAttemptCount: 4, oldestUnfinishedAgeSeconds: 90,
      lastCompletedAt: "2026-07-14T08:29:00.000Z",
    };
    const snapshotRow = {
      snapshotCount: 4, retryableSnapshots: 2, orphanedSnapshots: 1,
      missingRetrySnapshots: 1, bindingViolations: 0,
    };
    const execute = vi.fn()
      .mockResolvedValueOnce([claimRow]).mockResolvedValueOnce([snapshotRow])
      .mockResolvedValueOnce([claimRow]).mockResolvedValueOnce([snapshotRow]);
    await expect(getDisputeEvidenceScanRetryAlertSenderHealth(
      { execute } as unknown as Database, "fixture-alert-source",
    )).resolves.toMatchObject({
      status: "critical", processing: 1, completed: 2, failed: 3,
      staleProcessing: 1, retryReady: 2, maxAttemptCount: 4,
      oldestUnfinishedAgeSeconds: 90,
      lastCompletedAt: "2026-07-14T08:29:00.000Z",
      snapshotCount: 4, retryableSnapshots: 2, orphanedSnapshots: 1,
      missingRetrySnapshots: 1, bindingViolations: 0,
      containsIdentifiers: false,
    });
    const serialized = JSON.stringify(await getDisputeEvidenceScanRetryAlertSenderHealth(
      { execute } as unknown as Database, "fixture-alert-source",
    ));
    expect(serialized).not.toMatch(/fixture-alert-source|delivery|idempotency/);
  });

  it("fails closed for partial, weak, or unsafe configuration", () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_URL =
      "https://ops.example/scan-retry";
    expect(getDisputeEvidenceScanRetryAlertPolicyStatus())
      .toMatchObject({ configurationState: "partial", configured: false });
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = "short";
    expect(() => resolveDisputeEvidenceScanRetryAlertConfigFromEnv())
      .toThrow("16..128");
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = config.secret;
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_URL =
      "http://127.0.0.1/scan-retry";
    expect(getDisputeEvidenceScanRetryAlertPolicyStatus())
      .toMatchObject({ configurationState: "invalid", configured: false });
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_URL = config.url;
    expect(resolveDisputeEvidenceScanRetryAlertConfigFromEnv())
      .toMatchObject({ url: config.url, retryReadyThreshold: 10 });
  });

  it("sends a signed aggregate-only payload and verifies it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const now = new Date("2026-07-14T08:30:00.000Z");
    const deliveryId = `health_${"a".repeat(64)}`;
    const assessment = evaluateDisputeEvidenceScanRetryAlert(
      health({ exhausted: 1, failed: 1, quarantined: 1 }), circuit(), config,
      retention(), retentionJob(),
    );
    await expect(sendDisputeEvidenceScanRetryAlert(
      health({ exhausted: 1, failed: 1, quarantined: 1 }), circuit(), assessment,
      { config, deliveryId, retention: retention(), retentionJob: retentionJob(),
        fetchImpl: fetchImpl as typeof fetch, now },
    )).resolves.toEqual({ status: "delivered", httpStatus: 204 });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    const rawBody = String(init.body);
    expect(rawBody).not.toMatch(/upload|dispute_id|storage_path|lease_token/);
    const verification = verifyDisputeEvidenceScanRetryAlert({
      rawBody,
      timestamp: headers.get("x-haggle-alert-timestamp") ?? "",
      signature: headers.get("x-haggle-alert-signature") ?? "",
      deliveryId: headers.get("x-haggle-alert-delivery-id") ?? "",
      secret: config.secret,
      nowMs: now.getTime(),
    });
    expect(verification).toMatchObject({
      ok: true, deliveryId, state: "firing", severity: "critical",
    });
    const parsedBody = JSON.parse(rawBody);
    expect(parsedBody).toMatchObject({
      schema_version: "dispute-evidence-scan-retry-alert-v3",
      thresholds: { retention_blocked_expired: 1 },
      health: { retention: { blocked_expired: 0, job: {
        active: true, status: "healthy", last_run_status: "SUCCEEDED",
      } } },
    });
    const legacyBody = structuredClone(parsedBody);
    legacyBody.schema_version = "dispute-evidence-scan-retry-alert-v2";
    delete legacyBody.thresholds.retention_blocked_expired;
    delete legacyBody.health.retention;
    const legacyRawBody = JSON.stringify(legacyBody);
    expect(verifyDisputeEvidenceScanRetryAlert({
      rawBody: legacyRawBody,
      timestamp: headers.get("x-haggle-alert-timestamp") ?? "",
      signature: signWebhookClaimAlertPayload(
        config.secret, now.toISOString(), legacyRawBody,
      ),
      deliveryId,
      secret: config.secret,
      nowMs: now.getTime(),
    })).toMatchObject({ ok: true, deliveryId, severity: "critical" });
    expect(verifyDisputeEvidenceScanRetryAlert({
      rawBody,
      timestamp: headers.get("x-haggle-alert-timestamp") ?? "",
      signature: headers.get("x-haggle-alert-signature") ?? "",
      deliveryId,
      secret: [config.secret, config.secret],
      nowMs: now.getTime(),
    })).toEqual({ ok: false, error: "INVALID_ALERT_SIGNATURE" });
  });

  it("rejects tampering, stale timestamps, and invalid recovery", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const now = new Date("2026-07-14T08:30:00.000Z");
    await sendDisputeEvidenceScanRetryAlert(
      health({ staleProcessing: 1 }), circuit(),
      evaluateDisputeEvidenceScanRetryAlert(
        health({ staleProcessing: 1 }), circuit(), config,
        retention(), retentionJob(),
      ),
      { config, deliveryId: `health_${"b".repeat(64)}`,
        retention: retention(), retentionJob: retentionJob(),
        fetchImpl: fetchImpl as typeof fetch, now },
    );
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    const input = {
      rawBody: String(init.body),
      timestamp: headers.get("x-haggle-alert-timestamp") ?? "",
      signature: headers.get("x-haggle-alert-signature") ?? "",
      deliveryId: headers.get("x-haggle-alert-delivery-id") ?? "",
      secret: config.secret,
    };
    expect(verifyDisputeEvidenceScanRetryAlert({
      ...input, nowMs: now.getTime() + 300_001,
    })).toEqual({ ok: false, error: "ALERT_TIMESTAMP_OUT_OF_RANGE" });
    const body = JSON.parse(input.rawBody);
    body.health.totals.stale_processing = 0;
    const semanticallyInvalidBody = JSON.stringify(body);
    expect(verifyDisputeEvidenceScanRetryAlert({
      ...input,
      rawBody: semanticallyInvalidBody,
      signature: signWebhookClaimAlertPayload(
        config.secret, input.timestamp, semanticallyInvalidBody,
      ),
      nowMs: now.getTime(),
    })).toEqual({ ok: false, error: "INVALID_ALERT_BODY" });

    const inconsistentCircuit = JSON.parse(input.rawBody);
    inconsistentCircuit.health.circuit.state = "CLOSED";
    inconsistentCircuit.health.circuit.consecutive_failures = 3;
    const inconsistentCircuitBody = JSON.stringify(inconsistentCircuit);
    expect(verifyDisputeEvidenceScanRetryAlert({
      ...input,
      rawBody: inconsistentCircuitBody,
      signature: signWebhookClaimAlertPayload(
        config.secret, input.timestamp, inconsistentCircuitBody,
      ),
      nowMs: now.getTime(),
    })).toEqual({ ok: false, error: "INVALID_ALERT_BODY" });

    const inconsistentRetention = JSON.parse(input.rawBody);
    inconsistentRetention.health.retention.job.status = "inactive";
    const inconsistentRetentionBody = JSON.stringify(inconsistentRetention);
    expect(verifyDisputeEvidenceScanRetryAlert({
      ...input,
      rawBody: inconsistentRetentionBody,
      signature: signWebhookClaimAlertPayload(
        config.secret, input.timestamp, inconsistentRetentionBody,
      ),
      nowMs: now.getTime(),
    })).toEqual({ ok: false, error: "INVALID_ALERT_BODY" });
  });

  it("rejects a hashable snapshot whose reasons contradict its aggregate", async () => {
    const assessment = evaluateDisputeEvidenceScanRetryAlert(
      health({ exhausted: 1 }), circuit(), config, retention(), retentionJob(),
    );
    const snapshot = createDisputeEvidenceScanRetryAlertSnapshot(
      health({ exhausted: 1 }), circuit(), assessment, config,
      `health_${"d".repeat(64)}`, retention(), retentionJob(),
    );
    snapshot.reasons = ["scan_retry_ready_backlog"];
    const fetchImpl = vi.fn();
    await expect(sendDisputeEvidenceScanRetryAlert(
      health({ exhausted: 1 }), circuit(), assessment,
      { config, deliveryId: snapshot.delivery_id, snapshot,
        fetchImpl: fetchImpl as typeof fetch },
    )).rejects.toThrow("SNAPSHOT_INVALID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("supports bounded receiver secret rotation", () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = config.secret;
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_PREVIOUS_SECRETS =
      "previous-scan-retry-secret";
    expect(resolveDisputeEvidenceScanRetryAlertReceiverSecretsFromEnv())
      .toEqual([config.secret, "previous-scan-retry-secret"]);
    expect(getDisputeEvidenceScanRetryAlertReceiverPolicyStatus())
      .toMatchObject({ configurationState: "valid", acceptedSecretCount: 2 });
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_PREVIOUS_SECRETS =
      `${config.secret}`;
    expect(getDisputeEvidenceScanRetryAlertReceiverPolicyStatus())
      .toMatchObject({ configurationState: "invalid", acceptedSecretCount: 0 });
  });

  it("redacts transport failures", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(
      new Error("https://secret-host?token=private"),
    );
    await expect(sendDisputeEvidenceScanRetryAlert(
      health({ retryReady: 10 }), circuit(),
      evaluateDisputeEvidenceScanRetryAlert(
        health({ retryReady: 10 }), circuit(), config,
        retention(), retentionJob(),
      ),
      { config, deliveryId: `health_${"c".repeat(64)}`,
        retention: retention(), retentionJob: retentionJob(),
        fetchImpl: fetchImpl as typeof fetch },
    )).resolves.toEqual({
      status: "failed", error: "ALERT_DELIVERY_FAILED",
    });
  });
});
