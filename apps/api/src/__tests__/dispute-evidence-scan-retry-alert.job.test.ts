import type { Database } from "@haggle/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDisputeEvidenceScanRetryAlert } from "../jobs/dispute-evidence-scan-retry-alert.js";
import { getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth } from "../jobs/dispute-evidence-scan-retry-alert-snapshot-retention.js";
import { getDisputeEvidenceScanRetryHealth } from "../services/dispute-evidence-scan-retry.service.js";
import {
  createDisputeEvidenceScanRetryAlertSnapshot,
  type DisputeEvidenceScanRetryAlertConfig,
  type DisputeEvidenceScanRetryAlertSnapshotRetentionHealth,
  type DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth,
  findLatestDeliveredDisputeEvidenceScanRetryIncident,
  findRetryableDisputeEvidenceScanRetryAlertSnapshot,
  hasRecentDeliveredDisputeEvidenceScanRetryIncident,
  persistDisputeEvidenceScanRetryAlertSnapshot,
  sendDisputeEvidenceScanRetryAlert,
} from "../services/dispute-evidence-scan-retry-alert.service.js";
import { getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth } from "../services/dispute-evidence-scan-retry-alert-snapshot-retention.service.js";
import { getDisputeEvidenceScannerCircuitHealth } from "../services/dispute-evidence-scanner-circuit.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from "../services/webhook-event-claim.service.js";

vi.mock("../services/dispute-evidence-scan-retry.service.js", () => ({
  getDisputeEvidenceScanRetryHealth: vi.fn(),
}));
vi.mock("../services/dispute-evidence-scanner-circuit.service.js", () => ({
  getDisputeEvidenceScannerCircuitHealth: vi.fn(),
}));
vi.mock("../services/dispute-evidence-scan-retry-alert-snapshot-retention.service.js", () => ({
  getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth: vi.fn(),
}));
vi.mock("../jobs/dispute-evidence-scan-retry-alert-snapshot-retention.js", () => ({
  getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth: vi.fn(),
}));
vi.mock("../services/dispute-evidence-scan-retry-alert.service.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../services/dispute-evidence-scan-retry-alert.service.js")
    >();
  return {
    ...original,
    findLatestDeliveredDisputeEvidenceScanRetryIncident: vi.fn(),
    findRetryableDisputeEvidenceScanRetryAlertSnapshot: vi.fn(),
    hasRecentDeliveredDisputeEvidenceScanRetryIncident: vi.fn(),
    persistDisputeEvidenceScanRetryAlertSnapshot: vi.fn(),
    sendDisputeEvidenceScanRetryAlert: vi.fn(),
  };
});
vi.mock("../services/webhook-event-claim.service.js", () => ({
  claimWebhookEvent: vi.fn(),
  completeWebhookEvent: vi.fn(),
  failWebhookEvent: vi.fn(),
  webhookPayloadSha256: vi.fn(() => "d".repeat(64)),
}));

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
const health = (exhausted = 1) => ({
  schemaVersion: "dispute-evidence-scan-retry-health-v1" as const,
  status: exhausted ? ("attention" as const) : ("healthy" as const),
  job: { enabled: true, cronEnabled: true },
  scanner: {
    schemaVersion: "dispute-evidence-scanner-readiness-v1" as const,
    configurationState: "valid" as const,
    configured: true,
    authenticated: true,
    transport: { httpsRequired: true, insecureHttpOverride: false },
    network: {
      privateNetworkBlocked: true,
      redirectsBlocked: true,
      dnsResolutionValidated: true,
      dnsConnectionPinned: true,
    },
    limits: {
      timeoutMs: 15_000,
      maxResponseBytes: 16_384,
      maxFilenameChars: 160,
      maxResolvedAddresses: 16,
    },
    containsUrl: false,
    containsToken: false,
  },
  policy: {
    batchSize: 10,
    maxAttempts: 5,
    leaseSeconds: 60,
    baseBackoffSeconds: 30,
    maxBackoffSeconds: 3_600,
  },
  totals: {
    quarantined: exhausted,
    pending: 0,
    failed: exhausted,
    processing: 0,
    staleProcessing: 0,
    retryReady: 0,
    exhausted,
    expiredQuarantined: 0,
  },
  oldestUnresolvedAgeSeconds: exhausted ? 300 : null,
  containsIdentifiers: false,
  containsStoragePaths: false,
  containsLeaseTokens: false,
  observedAt: "2026-07-14T08:30:00.000Z",
});
const circuit = (state: "CLOSED" | "OPEN" = "CLOSED") => ({
  schemaVersion: "dispute-evidence-scanner-circuit-health-v1" as const,
  status: state === "CLOSED" ? ("healthy" as const) : ("attention" as const),
  state,
  consecutiveFailures: state === "CLOSED" ? 0 : 3,
  activePermits: 0,
  policy: { failureThreshold: 3, openSeconds: 60, permitLeaseSeconds: 30, maxConcurrent: 4 },
  nextProbeAt: state === "OPEN" ? "2026-07-14T08:31:00.000Z" : null,
  probeExpiresAt: null,
  lastSuccessAt: null,
  lastFailureAt: state === "OPEN" ? "2026-07-14T08:30:00.000Z" : null,
  containsPermitTokens: false,
  containsCircuitKey: false,
  observedAt: "2026-07-14T08:30:00.000Z",
});
const retention = (blockedExpired = 0): DisputeEvidenceScanRetryAlertSnapshotRetentionHealth => ({
  status: blockedExpired ? "attention" : "healthy",
  eligibleExpired: 0,
  blockedExpired,
  oldestBlockedExpiredAgeSeconds: blockedExpired ? 60 : null,
  policy: { retentionDays: 30, batchSize: 100, jobEnabled: true, cronEnabled: true },
  containsIdentifiers: false,
  recordedAt: "2026-07-14T08:30:00.000Z",
});
const retentionJob = (
  overrides: Partial<DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth> = {},
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
  policy: {
    jobEnabled: true,
    cronEnabled: true,
    intervalSeconds: 86_400,
    leaseSeconds: 900,
    maxStartDelaySeconds: 93_600,
  },
  containsIdentifiers: false,
  recordedAt: "2026-07-14T08:30:00.000Z",
  ...overrides,
});

describe("dispute evidence scan retry alert job", () => {
  beforeEach(() => {
    vi.mocked(getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth).mockResolvedValue(
      retention(),
    );
    vi.mocked(getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth).mockResolvedValue(
      retentionJob(),
    );
    vi.mocked(findRetryableDisputeEvidenceScanRetryAlertSnapshot).mockResolvedValue(null);
    vi.mocked(hasRecentDeliveredDisputeEvidenceScanRetryIncident).mockResolvedValue(false);
    vi.mocked(persistDisputeEvidenceScanRetryAlertSnapshot).mockImplementation(
      async (_db, _source, snapshot) => ({
        snapshot,
        payloadSha256: "d".repeat(64),
      }),
    );
  });
  afterEach(() => vi.clearAllMocks());

  it("retries the immutable snapshot before creating a new cooldown alert", async () => {
    vi.mocked(getDisputeEvidenceScanRetryHealth).mockResolvedValue(health());
    vi.mocked(getDisputeEvidenceScannerCircuitHealth).mockResolvedValue(circuit());
    const saved = createDisputeEvidenceScanRetryAlertSnapshot(
      health(),
      circuit(),
      {
        wouldAlert: true,
        severity: "critical",
        reasons: ["scan_retry_exhausted"],
      },
      config,
      `health_${"9".repeat(64)}`,
      retention(),
      retentionJob(),
    );
    vi.mocked(findRetryableDisputeEvidenceScanRetryAlertSnapshot).mockResolvedValueOnce({
      snapshot: saved,
      payloadSha256: "e".repeat(64),
    });
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "source",
      eventId: saved.delivery_id,
      claimId: crypto.randomUUID(),
      attemptCount: 2,
    });
    vi.mocked(sendDisputeEvidenceScanRetryAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 204,
    });

    await expect(
      runDisputeEvidenceScanRetryAlert({} as Database, {
        config,
        now: new Date("2026-07-14T09:31:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "retried",
      phase: "incident",
      attemptCount: 2,
    });
    expect(persistDisputeEvidenceScanRetryAlertSnapshot).not.toHaveBeenCalled();
    expect(sendDisputeEvidenceScanRetryAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        deliveryId: saved.delivery_id,
        snapshot: saved,
      }),
    );
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
  });

  it("delivers one claimed incident and suppresses another server", async () => {
    vi.mocked(getDisputeEvidenceScanRetryHealth).mockResolvedValue(health());
    vi.mocked(getDisputeEvidenceScannerCircuitHealth).mockResolvedValue(circuit());
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({
        outcome: "acquired",
        source: "source",
        eventId: `health_${"a".repeat(64)}`,
        claimId: crypto.randomUUID(),
        attemptCount: 1,
      })
      .mockResolvedValueOnce({
        outcome: "duplicate",
        source: "source",
        eventId: `health_${"a".repeat(64)}`,
      });
    vi.mocked(sendDisputeEvidenceScanRetryAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 204,
    });
    await expect(
      runDisputeEvidenceScanRetryAlert({} as Database, { config }),
    ).resolves.toMatchObject({ status: "delivered" });
    await expect(
      runDisputeEvidenceScanRetryAlert({} as Database, { config }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "cooldown_or_in_progress",
    });
    expect(sendDisputeEvidenceScanRetryAlert).toHaveBeenCalledOnce();
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
  });

  it("marks failed delivery for bounded claim retry", async () => {
    vi.mocked(getDisputeEvidenceScanRetryHealth).mockResolvedValue(health());
    vi.mocked(getDisputeEvidenceScannerCircuitHealth).mockResolvedValue(circuit());
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "source",
      eventId: `health_${"b".repeat(64)}`,
      claimId: crypto.randomUUID(),
      attemptCount: 1,
    });
    vi.mocked(sendDisputeEvidenceScanRetryAlert).mockResolvedValueOnce({
      status: "failed",
      error: "ALERT_DELIVERY_FAILED",
    });
    await expect(
      runDisputeEvidenceScanRetryAlert({} as Database, { config }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(failWebhookEvent).toHaveBeenCalledOnce();
  });

  it("distinguishes sender retry backoff and claim conflicts", async () => {
    vi.mocked(getDisputeEvidenceScanRetryHealth).mockResolvedValue(health());
    vi.mocked(getDisputeEvidenceScannerCircuitHealth).mockResolvedValue(circuit());
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({
        outcome: "retry_later",
        source: "source",
        eventId: `health_${"f".repeat(64)}`,
        retryAfterSeconds: 2,
      })
      .mockResolvedValueOnce({
        outcome: "payload_conflict",
        source: "source",
        eventId: `health_${"f".repeat(64)}`,
      });
    await expect(
      runDisputeEvidenceScanRetryAlert({} as Database, { config }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "delivery_retry_backoff",
    });
    await expect(
      runDisputeEvidenceScanRetryAlert({} as Database, { config }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "delivery_claim_payload_conflict",
    });
    expect(sendDisputeEvidenceScanRetryAlert).not.toHaveBeenCalled();
  });

  it("sends one recovery only after a delivered incident", async () => {
    vi.mocked(getDisputeEvidenceScanRetryHealth).mockResolvedValue(health(0));
    vi.mocked(getDisputeEvidenceScannerCircuitHealth).mockResolvedValue(circuit());
    vi.mocked(findLatestDeliveredDisputeEvidenceScanRetryIncident)
      .mockResolvedValueOnce({
        eventId: `health_${"c".repeat(64)}`,
        completedAt: "2026-07-14T08:30:00.000Z",
      })
      .mockResolvedValueOnce({
        eventId: `health_${"c".repeat(64)}`,
        completedAt: "2026-07-14T08:30:00.000Z",
      });
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({
        outcome: "acquired",
        source: "source",
        eventId: `recovery_${"d".repeat(64)}`,
        claimId: crypto.randomUUID(),
        attemptCount: 1,
      })
      .mockResolvedValueOnce({
        outcome: "duplicate",
        source: "source",
        eventId: `recovery_${"d".repeat(64)}`,
      });
    vi.mocked(sendDisputeEvidenceScanRetryAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 204,
    });
    await expect(
      runDisputeEvidenceScanRetryAlert({} as Database, { config }),
    ).resolves.toMatchObject({ status: "recovered" });
    await expect(
      runDisputeEvidenceScanRetryAlert({} as Database, { config }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "recovery_already_sent_or_in_progress",
    });
  });

  it("stays silent when healthy without an incident", async () => {
    vi.mocked(getDisputeEvidenceScanRetryHealth).mockResolvedValue(health(0));
    vi.mocked(getDisputeEvidenceScannerCircuitHealth).mockResolvedValue(circuit());
    vi.mocked(findLatestDeliveredDisputeEvidenceScanRetryIncident).mockResolvedValueOnce(null);
    await expect(
      runDisputeEvidenceScanRetryAlert({} as Database, { config }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "healthy_no_delivered_incident",
    });
    expect(claimWebhookEvent).not.toHaveBeenCalled();
  });

  it("alerts on an open circuit before a retry backlog exists", async () => {
    vi.mocked(getDisputeEvidenceScanRetryHealth).mockResolvedValue(health(0));
    vi.mocked(getDisputeEvidenceScannerCircuitHealth).mockResolvedValue(circuit("OPEN"));
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "source",
      eventId: `health_${"e".repeat(64)}`,
      claimId: crypto.randomUUID(),
      attemptCount: 1,
    });
    vi.mocked(sendDisputeEvidenceScanRetryAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 204,
    });
    await expect(
      runDisputeEvidenceScanRetryAlert({} as Database, { config }),
    ).resolves.toMatchObject({
      status: "delivered",
      assessment: { severity: "critical", reasons: ["scanner_circuit_open"] },
    });
  });

  it("alerts when expired snapshots are blocked without a retry backlog", async () => {
    vi.mocked(getDisputeEvidenceScanRetryHealth).mockResolvedValue(health(0));
    vi.mocked(getDisputeEvidenceScannerCircuitHealth).mockResolvedValue(circuit());
    vi.mocked(getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth).mockResolvedValue(
      retention(1),
    );
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "source",
      eventId: `health_${"7".repeat(64)}`,
      claimId: crypto.randomUUID(),
      attemptCount: 1,
    });
    vi.mocked(sendDisputeEvidenceScanRetryAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 204,
    });
    await expect(
      runDisputeEvidenceScanRetryAlert({} as Database, { config }),
    ).resolves.toMatchObject({
      status: "delivered",
      assessment: {
        severity: "critical",
        reasons: ["alert_snapshot_retention_blocked"],
      },
    });
  });
});
