import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateShipmentApvCursorRetentionAlert,
  evaluateShipmentApvPayoutAlert,
  resolveShipmentApvPayoutAlertConfigFromEnv,
  sendShipmentApvPayoutAlert,
} from "../services/shipment-apv-payout-alert.service.js";

const health = {
  status: "attention" as const,
  expiredReserved: 2,
  signedExpired: 1,
  unsignedExpired: 1,
  affectedSellers: 2,
  appliedOffsetMinor: 60,
  oldestExpiredAgeSeconds: 900,
  recordedAt: "2026-07-12T00:00:00.000Z",
};
const config = {
  url: "https://ops.example/alerts",
  secret: "ops-alert-secret-with-length",
  timeoutMs: 5000,
  cooldownMinutes: 15,
  expiredThreshold: 1,
  approvalPendingThreshold: 1,
  approvalMaxAgeMinutes: 15,
  allowInsecureHttp: false,
  allowPrivateNetwork: false,
};
const healthyInvoiceStorage = {
  status: "healthy" as const, totalDocuments: 1, checkedDocuments: 1, missingFiles: 0,
  sizeMismatches: 0, hashMismatches: 0, orphanFiles: 0, invalidEntries: 0,
  scanTruncated: false, checkedBytes: 128, recordedAt: "2026-07-12T00:00:00.000Z",
};
const healthyRestorationStaging = {
  status: "healthy" as const, trackedStaging: 0, pendingDisposition: 0, staleMoving: 0,
  missingSources: 0, hashMismatches: 0, invalidEntries: 0, checkedBytes: 0,
  scanTruncated: false, recordedAt: "2026-07-12T00:00:00.000Z",
};
const healthyRestorationRemediation = {
  status: "healthy" as const, pendingRequests: 0, applyingRequests: 0, expiringSoonRequests: 0,
  overduePendingRequests: 0, staleApplyingRequests: 0, oldestPendingAgeSeconds: null,
  staleApplyingOver15Minutes: 0, staleApplyingOver60Minutes: 0,
  unacknowledgedStaleOver60Minutes: 0, incidentUnlinkedStaleOver60Minutes: 0,
  acknowledgedStillApplyingOver30Minutes: 0, incidentLinkedStillApplyingOver30Minutes: 0,
  incidentLinkOverdueAfterAcknowledgment: 0,
  oldestApplyingAgeSeconds: null, staleApplyingAgeBucket: "none" as const,
  recordedAt: "2026-07-12T00:00:00.000Z",
};
const healthyCursorRetention = {
  lastRunStatus: "SUCCEEDED" as const, leaseStale: false,
  firstObservedAt: "2026-07-11T23:59:00.000Z",
  lastStartedAt: "2026-07-12T00:00:00.000Z", lastSucceededAt: "2026-07-12T00:00:02.000Z",
  lastFailedAt: null, lastDeletedBuckets: 2, lastExpiredBuckets: 1, lastInvalidBuckets: 1,
  lastTruncated: false, lastFailureCode: null, recordedAt: "2026-07-12T00:00:03.000Z",
};
const enabledCursorRetention = {
  jobEnabled: true, configured: true, intervalSeconds: 86_400, health: healthyCursorRetention,
};

describe("shipment APV payout reservation alerts", () => {
  afterEach(() => {
    delete process.env.SHIPMENT_APV_PAYOUT_ALERT_URL;
    delete process.env.SHIPMENT_APV_PAYOUT_ALERT_SECRET;
  });

  it("raises a critical aggregate alert at the configured threshold", () => {
    expect(evaluateShipmentApvPayoutAlert(health, config)).toEqual({
      wouldAlert: true,
      severity: "critical",
      reasons: ["expired_reserved_payout"],
    });
  });

  it("alerts when a cancellation approval waits beyond the SLA", () => {
    expect(evaluateShipmentApvPayoutAlert(
      { ...health, status: "healthy", expiredReserved: 0 },
      config,
      {
        status: "attention",
        pendingRequests: 1,
        expiringSoonRequests: 1,
        oldestPendingAgeSeconds: 901,
        recordedAt: "2026-07-12T00:00:00.000Z",
      },
    )).toEqual({
      wouldAlert: true,
      severity: "critical",
      reasons: ["approval_waiting_too_long"],
    });
  });

  it("classifies missing or tampered invoices as critical and orphan files as warning", () => {
    const healthyPayout = { ...health, status: "healthy" as const, expiredReserved: 0 };
    expect(evaluateShipmentApvPayoutAlert(healthyPayout, config, undefined, {
      ...healthyInvoiceStorage, status: "critical", missingFiles: 1,
    })).toMatchObject({ wouldAlert: true, severity: "critical", reasons: ["invoice_document_missing"] });
    expect(evaluateShipmentApvPayoutAlert(healthyPayout, config, undefined, {
      ...healthyInvoiceStorage, status: "warning", orphanFiles: 1,
    })).toMatchObject({ wouldAlert: true, severity: "warning", reasons: ["invoice_document_orphan"] });
  });

  it("classifies staging backlog as warning and missing staged bytes as critical", () => {
    const healthyPayout = { ...health, status: "healthy" as const, expiredReserved: 0 };
    expect(evaluateShipmentApvPayoutAlert(healthyPayout, config, undefined, healthyInvoiceStorage, {
      ...healthyRestorationStaging, status: "warning", pendingDisposition: 1, staleMoving: 1,
    })).toEqual({ wouldAlert: true, severity: "warning",
      reasons: ["invoice_restoration_staging_pending", "invoice_restoration_staging_stale"] });
    expect(evaluateShipmentApvPayoutAlert(healthyPayout, config, undefined, healthyInvoiceStorage, {
      ...healthyRestorationStaging, status: "critical", missingSources: 1,
    })).toMatchObject({ wouldAlert: true, severity: "critical",
      reasons: ["invoice_restoration_staging_missing"] });
  });

  it("classifies expiring remediation as warning and overdue or stale apply as critical", () => {
    const healthyPayout = { ...health, status: "healthy" as const, expiredReserved: 0 };
    expect(evaluateShipmentApvPayoutAlert(healthyPayout, config, undefined, healthyInvoiceStorage,
      healthyRestorationStaging, { ...healthyRestorationRemediation, status: "warning", expiringSoonRequests: 1 }))
      .toEqual({ wouldAlert: true, severity: "warning", reasons: ["invoice_restoration_remediation_expiring"] });
    expect(evaluateShipmentApvPayoutAlert(healthyPayout, config, undefined, healthyInvoiceStorage,
      healthyRestorationStaging, { ...healthyRestorationRemediation, status: "critical", overduePendingRequests: 1,
        staleApplyingRequests: 1, staleApplyingOver15Minutes: 1, staleApplyingOver60Minutes: 1,
        unacknowledgedStaleOver60Minutes: 1, incidentUnlinkedStaleOver60Minutes: 1,
        oldestApplyingAgeSeconds: 3660, staleApplyingAgeBucket: "60m" })).toEqual({
        wouldAlert: true, severity: "critical", reasons: ["invoice_restoration_remediation_overdue",
          "invoice_restoration_remediation_stale_applying",
          "invoice_restoration_remediation_stale_applying_15m",
          "invoice_restoration_remediation_stale_applying_60m",
          "invoice_restoration_remediation_unacknowledged_60m",
          "invoice_restoration_remediation_incident_unlinked_60m"] });
  });

  it("fails safe when a long-stale aggregate is inconsistent with the five-minute count", () => {
    const healthyPayout = { ...health, status: "healthy" as const, expiredReserved: 0 };
    expect(evaluateShipmentApvPayoutAlert(healthyPayout, config, undefined, healthyInvoiceStorage,
      healthyRestorationStaging, { ...healthyRestorationRemediation,
        staleApplyingOver60Minutes: 1, oldestApplyingAgeSeconds: 3600,
        staleApplyingAgeBucket: "60m" })).toEqual({ wouldAlert: true, severity: "critical",
        reasons: ["invoice_restoration_remediation_stale_applying_60m"] });
  });

  it("fails safe when acknowledgment handling aggregates are inconsistent", () => {
    const healthyPayout = { ...health, status: "healthy" as const, expiredReserved: 0 };
    expect(evaluateShipmentApvPayoutAlert(healthyPayout, config, undefined, healthyInvoiceStorage,
      healthyRestorationStaging, { ...healthyRestorationRemediation,
        unacknowledgedStaleOver60Minutes: 1, incidentUnlinkedStaleOver60Minutes: 1 }))
      .toEqual({ wouldAlert: true, severity: "critical", reasons: [
        "invoice_restoration_remediation_unacknowledged_60m",
        "invoice_restoration_remediation_incident_unlinked_60m",
      ] });
  });

  it("re-escalates when an acknowledged incident remains applying for 30 minutes", () => {
    const healthyPayout = { ...health, status: "healthy" as const, expiredReserved: 0 };
    expect(evaluateShipmentApvPayoutAlert(healthyPayout, config, undefined, healthyInvoiceStorage,
      healthyRestorationStaging, { ...healthyRestorationRemediation,
        acknowledgedStillApplyingOver30Minutes: 1, incidentLinkedStillApplyingOver30Minutes: 1 }))
      .toEqual({ wouldAlert: true, severity: "critical", reasons: [
        "invoice_restoration_remediation_acknowledged_still_applying_30m",
        "invoice_restoration_remediation_incident_linked_still_applying_30m",
      ] });
  });

  it("escalates when incident linking misses the post-acknowledgment SLA", () => {
    const healthyPayout = { ...health, status: "healthy" as const, expiredReserved: 0 };
    expect(evaluateShipmentApvPayoutAlert(healthyPayout, config, undefined, healthyInvoiceStorage,
      healthyRestorationStaging, { ...healthyRestorationRemediation,
        incidentLinkOverdueAfterAcknowledgment: 1 }))
      .toEqual({ wouldAlert: true, severity: "critical", reasons: [
        "invoice_restoration_remediation_incident_link_overdue_after_ack_15m",
      ] });
  });

  it("alerts only for active failed, stale, or overdue cursor retention execution", () => {
    const now = new Date("2026-07-13T02:00:03.001Z");
    expect(evaluateShipmentApvCursorRetentionAlert({
      ...enabledCursorRetention, jobEnabled: false,
    }, now)).toEqual({ wouldAlert: false, severity: null, reasons: [] });
    expect(evaluateShipmentApvCursorRetentionAlert({ ...enabledCursorRetention, health: {
      ...healthyCursorRetention, firstObservedAt: "2026-07-13T01:59:00.000Z",
      lastRunStatus: "NEVER", lastStartedAt: null, lastSucceededAt: null,
    } }, now)).toEqual({ wouldAlert: false, severity: null, reasons: [] });
    expect(evaluateShipmentApvCursorRetentionAlert({ ...enabledCursorRetention, health: {
      ...healthyCursorRetention, lastRunStatus: "NEVER", lastStartedAt: null, lastSucceededAt: null,
    } }, now)).toEqual({ wouldAlert: true, severity: "warning",
      reasons: ["invoice_restoration_cursor_retention_never_started"] });
    expect(evaluateShipmentApvCursorRetentionAlert({ ...enabledCursorRetention, health: {
      ...healthyCursorRetention, lastRunStatus: "FAILED", lastFailureCode: "RETENTION_EXECUTION_FAILED",
    } }, now)).toEqual({ wouldAlert: true, severity: "critical",
      reasons: ["invoice_restoration_cursor_retention_failed"] });
    expect(evaluateShipmentApvCursorRetentionAlert({ ...enabledCursorRetention, health: {
      ...healthyCursorRetention, lastRunStatus: "STALE_RUNNING", leaseStale: true,
    } }, now)).toEqual({ wouldAlert: true, severity: "critical",
      reasons: ["invoice_restoration_cursor_retention_stale_running"] });
    expect(evaluateShipmentApvCursorRetentionAlert(enabledCursorRetention, now)).toEqual({
      wouldAlert: true, severity: "warning",
      reasons: ["invoice_restoration_cursor_retention_success_overdue"],
    });
  });

  it("sends a signed payload without seller, order, or offset identifiers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    await expect(sendShipmentApvPayoutAlert(health, evaluateShipmentApvPayoutAlert(health, config), {
      config,
      invoiceStorageHealth: healthyInvoiceStorage,
      restorationStagingHealth: healthyRestorationStaging,
      restorationRemediationHealth: healthyRestorationRemediation,
      cursorRetentionJob: enabledCursorRetention,
      fetchImpl: fetchMock,
      now: new Date("2026-07-12T00:00:00.000Z"),
    })).resolves.toMatchObject({ status: "delivered", httpStatus: 200 });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = String(request.body);
    expect(request.headers).toMatchObject({
      "x-haggle-alert-type": "shipment_apv_payout_reservation.health",
      "x-haggle-alert-signature": expect.stringMatching(/^sha256=[0-9a-f]{64}$/),
    });
    expect(body).not.toContain("seller_id");
    expect(body).not.toContain("order_id");
    expect(body).not.toContain("offset_id");
    expect(JSON.parse(body).invoice_storage_health).toMatchObject({ status: "healthy", totalDocuments: 1 });
    expect(JSON.parse(body).invoice_restoration_staging_health).toMatchObject({ status: "healthy", trackedStaging: 0 });
    expect(JSON.parse(body).invoice_restoration_remediation_health).toMatchObject({ status: "healthy", pendingRequests: 0 });
    expect(JSON.parse(body).invoice_restoration_cursor_retention_job_health).toMatchObject({
      lastRunStatus: "SUCCEEDED", lastDeletedBuckets: 2,
    });
    expect(body).not.toMatch(/staging_key|requestId|decisionRequestId|approverId|candidate|sha256|claimId|leaseExpires/i);
  });

  it("rejects private targets and short signing secrets", async () => {
    await expect(sendShipmentApvPayoutAlert(health, evaluateShipmentApvPayoutAlert(health, config), {
      config: { ...config, url: "https://127.0.0.1/alerts" },
    })).rejects.toThrow("must not target localhost or private network hosts");
    process.env.SHIPMENT_APV_PAYOUT_ALERT_URL = "https://ops.example/alerts";
    process.env.SHIPMENT_APV_PAYOUT_ALERT_SECRET = "short";
    expect(() => resolveShipmentApvPayoutAlertConfigFromEnv()).toThrow("secret must be at least 16 characters");
  });
});
