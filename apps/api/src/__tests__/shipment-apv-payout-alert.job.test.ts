import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runShipmentApvPayoutAlert } from "../jobs/shipment-apv-payout-alert.js";
import { getShipmentApvRemediationCursorRetentionJobHealth } from "../jobs/shipment-apv-remediation-cursor-retention.js";
import { getShipmentApvInvoiceDocumentStorageHealth } from "../services/shipment-apv-invoice-document.service.js";
import { getShipmentApvInvoiceRestorationStagingHealth } from "../services/shipment-apv-invoice-restoration.service.js";
import { getShipmentApvInvoiceRestorationRemediationHealth } from "../services/shipment-apv-invoice-restoration-remediation.service.js";
import { sendShipmentApvPayoutAlert } from "../services/shipment-apv-payout-alert.service.js";
import { getShipmentApvPayoutCancellationApprovalHealth } from "../services/shipment-apv-payout-cancellation.service.js";
import { getShipmentApvPayoutReservationHealth } from "../services/shipment-apv-payout-offset.service.js";
import {
  findLatestDeliveredWebhookClaimIncident,
  getWebhookClaimAlertDeliveryState,
} from "../services/webhook-claim-alert.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from "../services/webhook-event-claim.service.js";

vi.mock("../services/shipment-apv-payout-offset.service.js", () => ({
  getShipmentApvPayoutReservationHealth: vi.fn(),
}));
vi.mock("../services/shipment-apv-payout-cancellation.service.js", () => ({
  getShipmentApvPayoutCancellationApprovalHealth: vi.fn(),
}));
vi.mock("../services/shipment-apv-invoice-document.service.js", () => ({
  getShipmentApvInvoiceDocumentStorageHealth: vi.fn(),
}));
vi.mock("../services/shipment-apv-invoice-restoration.service.js", () => ({
  getShipmentApvInvoiceRestorationStagingHealth: vi.fn(),
}));
vi.mock("../services/shipment-apv-invoice-restoration-remediation.service.js", () => ({
  getShipmentApvInvoiceRestorationRemediationHealth: vi.fn(),
}));
vi.mock("../jobs/shipment-apv-remediation-cursor-retention.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../jobs/shipment-apv-remediation-cursor-retention.js")>();
  return { ...original, getShipmentApvRemediationCursorRetentionJobHealth: vi.fn() };
});
vi.mock("../services/webhook-claim-alert.service.js", () => ({
  findLatestDeliveredWebhookClaimIncident: vi.fn(),
  getWebhookClaimAlertDeliveryState: vi.fn(),
}));
vi.mock("../services/shipment-apv-payout-alert.service.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../services/shipment-apv-payout-alert.service.js")>();
  return { ...original, sendShipmentApvPayoutAlert: vi.fn() };
});
vi.mock("../services/webhook-event-claim.service.js", () => ({
  claimWebhookEvent: vi.fn(),
  completeWebhookEvent: vi.fn(),
  failWebhookEvent: vi.fn(),
  webhookPayloadSha256: vi.fn(() => "a".repeat(64)),
}));

const attention = {
  status: "attention" as const,
  expiredReserved: 1,
  signedExpired: 1,
  unsignedExpired: 0,
  affectedSellers: 1,
  appliedOffsetMinor: 40,
  oldestExpiredAgeSeconds: 60,
  recordedAt: "2026-07-12T00:00:00.000Z",
};
const healthyInvoiceStorage = {
  status: "healthy" as const,
  totalDocuments: 1,
  checkedDocuments: 1,
  missingFiles: 0,
  sizeMismatches: 0,
  hashMismatches: 0,
  orphanFiles: 0,
  invalidEntries: 0,
  scanTruncated: false,
  checkedBytes: 128,
  recordedAt: "2026-07-12T00:00:00.000Z",
};
const healthyRestorationStaging = {
  status: "healthy" as const,
  trackedStaging: 0,
  pendingDisposition: 0,
  staleMoving: 0,
  missingSources: 0,
  hashMismatches: 0,
  invalidEntries: 0,
  checkedBytes: 0,
  scanTruncated: false,
  recordedAt: "2026-07-12T00:00:00.000Z",
};
const healthyRestorationRemediation = {
  status: "healthy" as const,
  pendingRequests: 0,
  applyingRequests: 0,
  expiringSoonRequests: 0,
  overduePendingRequests: 0,
  staleApplyingRequests: 0,
  oldestPendingAgeSeconds: null,
  staleApplyingOver15Minutes: 0,
  staleApplyingOver60Minutes: 0,
  unacknowledgedStaleOver60Minutes: 0,
  incidentUnlinkedStaleOver60Minutes: 0,
  acknowledgedStillApplyingOver30Minutes: 0,
  incidentLinkedStillApplyingOver30Minutes: 0,
  incidentLinkOverdueAfterAcknowledgment: 0,
  oldestApplyingAgeSeconds: null,
  staleApplyingAgeBucket: "none" as const,
  recordedAt: "2026-07-12T00:00:00.000Z",
};

describe("shipment APV payout alert job", () => {
  afterEach(() => {
    delete process.env.SHIPMENT_APV_PAYOUT_ALERT_URL;
    delete process.env.SHIPMENT_APV_PAYOUT_ALERT_SECRET;
    delete process.env.ENABLE_CRON;
    delete process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB;
    vi.clearAllMocks();
  });
  const prepareHealth = () => {
    vi.mocked(getShipmentApvInvoiceDocumentStorageHealth).mockResolvedValue(healthyInvoiceStorage);
    vi.mocked(getShipmentApvInvoiceRestorationStagingHealth).mockResolvedValue(
      healthyRestorationStaging,
    );
    vi.mocked(getShipmentApvInvoiceRestorationRemediationHealth).mockResolvedValue(
      healthyRestorationRemediation,
    );
    vi.mocked(getWebhookClaimAlertDeliveryState).mockResolvedValue({
      incidentOpen: false,
      lastIncidentAlertAt: null,
      lastRecoveryAlertAt: null,
    });
  };
  const configure = () => {
    process.env.SHIPMENT_APV_PAYOUT_ALERT_URL = "https://ops.example/alerts";
    process.env.SHIPMENT_APV_PAYOUT_ALERT_SECRET = "ops-alert-secret-with-length";
  };

  const healthyApprovals = {
    status: "healthy" as const,
    pendingRequests: 0,
    expiringSoonRequests: 0,
    oldestPendingAgeSeconds: null,
    recordedAt: "2026-07-12T00:00:00.000Z",
  };

  it("skips when unconfigured or healthy", async () => {
    await expect(runShipmentApvPayoutAlert({} as Database)).resolves.toEqual({
      status: "skipped",
      reason: "not_configured",
    });
    configure();
    prepareHealth();
    vi.mocked(getShipmentApvPayoutReservationHealth).mockResolvedValueOnce({
      ...attention,
      status: "healthy",
      expiredReserved: 0,
    });
    vi.mocked(getShipmentApvPayoutCancellationApprovalHealth).mockResolvedValueOnce(
      healthyApprovals,
    );
    await expect(runShipmentApvPayoutAlert({} as Database)).resolves.toMatchObject({
      status: "skipped",
      reason: "healthy",
    });
  });

  it("rejects fixture overrides in production and malformed fixture sources", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousVercelEnv = process.env.VERCEL_ENV;
    const fixture = {
      alertSource: "haggle-shipment-apv-payout-alert-fixture-11111111-1111-4111-8111-111111111111",
      config: {
        url: "https://ops.example/alerts",
        secret: "fixture-secret",
        timeoutMs: 5000,
        cooldownMinutes: 15,
        expiredThreshold: 1,
        approvalPendingThreshold: 1,
        approvalMaxAgeMinutes: 15,
        allowInsecureHttp: false,
        allowPrivateNetwork: false,
      },
      cursorRetentionStatus: {
        configured: true,
        jobEnabled: true,
        retentionDays: 30,
        limit: 1000,
        intervalSeconds: 86_400,
      },
    };
    try {
      process.env.NODE_ENV = "production";
      await expect(runShipmentApvPayoutAlert({} as Database, { fixture })).rejects.toThrow(
        "SHIPMENT_APV_ALERT_FIXTURE_FORBIDDEN_IN_PRODUCTION",
      );
      process.env.NODE_ENV = "test";
      process.env.VERCEL_ENV = "production";
      await expect(runShipmentApvPayoutAlert({} as Database, { fixture })).rejects.toThrow(
        "SHIPMENT_APV_ALERT_FIXTURE_FORBIDDEN_IN_PRODUCTION",
      );
      delete process.env.VERCEL_ENV;
      await expect(
        runShipmentApvPayoutAlert({} as Database, {
          fixture: { ...fixture, alertSource: "haggle-shipment-apv-payout-alert" },
        }),
      ).rejects.toThrow("INVALID_SHIPMENT_APV_ALERT_FIXTURE_SOURCE");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previousVercelEnv;
    }
  });

  it("delivers one claimed alert and suppresses a duplicate server", async () => {
    configure();
    prepareHealth();
    vi.mocked(getShipmentApvPayoutReservationHealth).mockResolvedValue(attention);
    vi.mocked(getShipmentApvPayoutCancellationApprovalHealth).mockResolvedValue(healthyApprovals);
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({
        outcome: "acquired",
        source: "haggle-shipment-apv-payout-alert",
        eventId: "health",
        claimId: "11111111-1111-4111-8111-111111111111",
        attemptCount: 1,
      })
      .mockResolvedValueOnce({
        outcome: "duplicate",
        source: "haggle-shipment-apv-payout-alert",
        eventId: "health",
      });
    vi.mocked(sendShipmentApvPayoutAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 200,
    });
    await expect(runShipmentApvPayoutAlert({} as Database)).resolves.toMatchObject({
      status: "delivered",
    });
    await expect(runShipmentApvPayoutAlert({} as Database)).resolves.toMatchObject({
      status: "skipped",
      reason: "cooldown_or_in_progress",
    });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
    expect(sendShipmentApvPayoutAlert).toHaveBeenCalledOnce();
  });

  it("marks failed delivery for retry", async () => {
    configure();
    prepareHealth();
    vi.mocked(getShipmentApvPayoutReservationHealth).mockResolvedValueOnce(attention);
    vi.mocked(getShipmentApvPayoutCancellationApprovalHealth).mockResolvedValueOnce(
      healthyApprovals,
    );
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "haggle-shipment-apv-payout-alert",
      eventId: "health",
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    });
    vi.mocked(sendShipmentApvPayoutAlert).mockResolvedValueOnce({
      status: "failed",
      httpStatus: 503,
    });
    await expect(runShipmentApvPayoutAlert({} as Database)).resolves.toMatchObject({
      status: "failed",
    });
    expect(failWebhookEvent).toHaveBeenCalledOnce();
  });

  it("delivers an invoice storage warning through the shared APV signed alert", async () => {
    configure();
    prepareHealth();
    vi.mocked(getShipmentApvPayoutReservationHealth).mockResolvedValue({
      ...attention,
      status: "healthy",
      expiredReserved: 0,
    });
    vi.mocked(getShipmentApvPayoutCancellationApprovalHealth).mockResolvedValue(healthyApprovals);
    vi.mocked(getShipmentApvInvoiceDocumentStorageHealth).mockResolvedValueOnce({
      ...healthyInvoiceStorage,
      status: "warning",
      orphanFiles: 1,
    });
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "haggle-shipment-apv-payout-alert",
      eventId: "health",
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    });
    vi.mocked(sendShipmentApvPayoutAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 202,
    });
    await expect(runShipmentApvPayoutAlert({} as Database)).resolves.toMatchObject({
      status: "delivered",
      assessment: { severity: "warning", reasons: ["invoice_document_orphan"] },
    });
  });

  it("delivers restoration staging backlog through the shared APV signed alert", async () => {
    configure();
    prepareHealth();
    vi.mocked(getShipmentApvPayoutReservationHealth).mockResolvedValue({
      ...attention,
      status: "healthy",
      expiredReserved: 0,
    });
    vi.mocked(getShipmentApvPayoutCancellationApprovalHealth).mockResolvedValue(healthyApprovals);
    vi.mocked(getShipmentApvInvoiceRestorationStagingHealth).mockResolvedValueOnce({
      ...healthyRestorationStaging,
      status: "warning",
      trackedStaging: 1,
      pendingDisposition: 1,
    });
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "haggle-shipment-apv-payout-alert",
      eventId: "health",
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    });
    vi.mocked(sendShipmentApvPayoutAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 202,
    });
    await expect(runShipmentApvPayoutAlert({} as Database)).resolves.toMatchObject({
      status: "delivered",
      assessment: { severity: "warning", reasons: ["invoice_restoration_staging_pending"] },
    });
    expect(sendShipmentApvPayoutAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        restorationStagingHealth: expect.objectContaining({ pendingDisposition: 1 }),
      }),
    );
  });

  it("escalates a 60-minute stale remediation without identifiers", async () => {
    configure();
    prepareHealth();
    vi.mocked(getShipmentApvPayoutReservationHealth).mockResolvedValue({
      ...attention,
      status: "healthy",
      expiredReserved: 0,
    });
    vi.mocked(getShipmentApvPayoutCancellationApprovalHealth).mockResolvedValue(healthyApprovals);
    vi.mocked(getShipmentApvInvoiceRestorationRemediationHealth).mockResolvedValueOnce({
      ...healthyRestorationRemediation,
      status: "critical",
      applyingRequests: 1,
      staleApplyingRequests: 1,
      staleApplyingOver15Minutes: 1,
      staleApplyingOver60Minutes: 1,
      unacknowledgedStaleOver60Minutes: 1,
      incidentUnlinkedStaleOver60Minutes: 1,
      oldestApplyingAgeSeconds: 3660,
      staleApplyingAgeBucket: "60m",
    });
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "haggle-shipment-apv-payout-alert",
      eventId: "health",
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    });
    vi.mocked(sendShipmentApvPayoutAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 202,
    });
    await expect(runShipmentApvPayoutAlert({} as Database)).resolves.toMatchObject({
      status: "delivered",
      assessment: {
        severity: "critical",
        reasons: [
          "invoice_restoration_remediation_stale_applying",
          "invoice_restoration_remediation_stale_applying_15m",
          "invoice_restoration_remediation_stale_applying_60m",
          "invoice_restoration_remediation_unacknowledged_60m",
          "invoice_restoration_remediation_incident_unlinked_60m",
        ],
      },
    });
    expect(sendShipmentApvPayoutAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        restorationRemediationHealth: expect.objectContaining({
          staleApplyingAgeBucket: "60m",
          oldestApplyingAgeSeconds: 3660,
        }),
      }),
    );
  });

  it("delivers active cursor retention failure through the shared signed alert", async () => {
    configure();
    prepareHealth();
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB = "true";
    vi.mocked(getShipmentApvPayoutReservationHealth).mockResolvedValue({
      ...attention,
      status: "healthy",
      expiredReserved: 0,
    });
    vi.mocked(getShipmentApvPayoutCancellationApprovalHealth).mockResolvedValue(healthyApprovals);
    vi.mocked(getShipmentApvRemediationCursorRetentionJobHealth).mockResolvedValueOnce({
      lastRunStatus: "FAILED",
      leaseStale: false,
      firstObservedAt: "2026-07-12T00:00:00.000Z",
      lastStartedAt: "2026-07-13T00:00:00.000Z",
      lastSucceededAt: null,
      lastFailedAt: "2026-07-13T00:00:01.000Z",
      lastDeletedBuckets: 0,
      lastExpiredBuckets: 0,
      lastInvalidBuckets: 0,
      lastTruncated: false,
      lastFailureCode: "RETENTION_EXECUTION_FAILED",
      recordedAt: "2026-07-13T00:00:02.000Z",
    });
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "haggle-shipment-apv-payout-alert",
      eventId: "health",
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    });
    vi.mocked(sendShipmentApvPayoutAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 202,
    });
    await expect(runShipmentApvPayoutAlert({} as Database)).resolves.toMatchObject({
      status: "delivered",
      assessment: {
        severity: "critical",
        reasons: ["invoice_restoration_cursor_retention_failed"],
      },
      cursorRetentionJob: { health: { lastRunStatus: "FAILED" } },
    });
    expect(sendShipmentApvPayoutAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        cursorRetentionJob: expect.objectContaining({
          health: expect.objectContaining({ lastFailureCode: "RETENTION_EXECUTION_FAILED" }),
        }),
      }),
    );
  });

  it("delivers one recovery only when a completed APV incident remains open", async () => {
    configure();
    prepareHealth();
    vi.mocked(getShipmentApvPayoutReservationHealth).mockResolvedValue({
      ...attention,
      status: "healthy",
      expiredReserved: 0,
    });
    vi.mocked(getShipmentApvPayoutCancellationApprovalHealth).mockResolvedValue(healthyApprovals);
    vi.mocked(getWebhookClaimAlertDeliveryState).mockResolvedValue({
      incidentOpen: true,
      lastIncidentAlertAt: "2026-07-12T00:00:00.000Z",
      lastRecoveryAlertAt: null,
    });
    vi.mocked(findLatestDeliveredWebhookClaimIncident).mockResolvedValue({
      eventId: `health_${"a".repeat(64)}`,
      completedAt: "2026-07-12T00:00:00.000Z",
    });
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({
        outcome: "acquired",
        source: "haggle-shipment-apv-payout-alert",
        eventId: "recovery",
        claimId: "11111111-1111-4111-8111-111111111111",
        attemptCount: 1,
      })
      .mockResolvedValueOnce({
        outcome: "duplicate",
        source: "haggle-shipment-apv-payout-alert",
        eventId: "recovery",
      });
    vi.mocked(sendShipmentApvPayoutAlert).mockResolvedValueOnce({
      status: "delivered",
      httpStatus: 200,
    });
    await expect(runShipmentApvPayoutAlert({} as Database)).resolves.toMatchObject({
      status: "delivered",
      assessment: { severity: "recovery", reasons: [] },
    });
    expect(claimWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: expect.stringMatching(/^recovery_[0-9a-f]{64}$/),
      }),
    );
    await expect(runShipmentApvPayoutAlert({} as Database)).resolves.toMatchObject({
      status: "skipped",
      reason: "cooldown_or_in_progress",
      assessment: { severity: "recovery" },
    });
    expect(sendShipmentApvPayoutAlert).toHaveBeenCalledOnce();
  });
});
