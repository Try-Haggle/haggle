import type { ShipmentApvPayoutReservationHealth } from "./shipment-apv-payout-offset.service.js";
import type { ShipmentApvPayoutCancellationApprovalHealth } from "./shipment-apv-payout-cancellation.service.js";
import type { ShipmentApvInvoiceDocumentStorageHealth } from "./shipment-apv-invoice-document.service.js";
import type { ShipmentApvInvoiceRestorationStagingHealth } from "./shipment-apv-invoice-restoration.service.js";
import type { ShipmentApvInvoiceRestorationRemediationHealth } from "./shipment-apv-invoice-restoration-remediation.service.js";
import type { ShipmentApvRemediationCursorRetentionJobHealth } from
  "../jobs/shipment-apv-remediation-cursor-retention.js";
import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";

export interface ShipmentApvPayoutAlertConfig {
  url: string;
  secret: string;
  timeoutMs: number;
  cooldownMinutes: number;
  expiredThreshold: number;
  approvalPendingThreshold: number;
  approvalMaxAgeMinutes: number;
  allowInsecureHttp: boolean;
  allowPrivateNetwork: boolean;
}

export interface ShipmentApvAlertAssessment {
  wouldAlert: boolean;
  severity: "warning" | "critical" | "recovery" | null;
  reasons: string[];
}

export interface ShipmentApvCursorRetentionMonitoring {
  jobEnabled: boolean;
  configured: boolean;
  intervalSeconds: number;
  health: ShipmentApvRemediationCursorRetentionJobHealth;
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function getShipmentApvPayoutAlertPolicyStatus() {
  return {
    configured: Boolean(process.env.SHIPMENT_APV_PAYOUT_ALERT_URL
      && (process.env.SHIPMENT_APV_PAYOUT_ALERT_SECRET?.length ?? 0) >= 16),
    jobEnabled: process.env.ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB === "true",
    cooldownMinutes: boundedInteger(process.env.SHIPMENT_APV_PAYOUT_ALERT_COOLDOWN_MINUTES, 15, 1, 1440),
    expiredThreshold: boundedInteger(process.env.SHIPMENT_APV_PAYOUT_ALERT_EXPIRED_THRESHOLD, 1, 1, 100_000),
    approvalPendingThreshold: boundedInteger(process.env.SHIPMENT_APV_PAYOUT_ALERT_APPROVAL_PENDING_THRESHOLD, 1, 1, 100_000),
    approvalMaxAgeMinutes: boundedInteger(process.env.SHIPMENT_APV_PAYOUT_ALERT_APPROVAL_MAX_AGE_MINUTES, 15, 1, 29),
  };
}

export function resolveShipmentApvPayoutAlertConfigFromEnv(): ShipmentApvPayoutAlertConfig | null {
  const url = process.env.SHIPMENT_APV_PAYOUT_ALERT_URL;
  if (!url) return null;
  const secret = process.env.SHIPMENT_APV_PAYOUT_ALERT_SECRET ?? "";
  if (secret.length < 16) throw new Error("shipment APV payout alert secret must be at least 16 characters");
  const policy = getShipmentApvPayoutAlertPolicyStatus();
  const config = {
    url,
    secret,
    timeoutMs: boundedInteger(process.env.SHIPMENT_APV_PAYOUT_ALERT_TIMEOUT_MS, 5000, 250, 30_000),
    cooldownMinutes: policy.cooldownMinutes,
    expiredThreshold: policy.expiredThreshold,
    approvalPendingThreshold: policy.approvalPendingThreshold,
    approvalMaxAgeMinutes: policy.approvalMaxAgeMinutes,
    allowInsecureHttp: process.env.SHIPMENT_APV_PAYOUT_ALERT_ALLOW_INSECURE_HTTP === "true",
    allowPrivateNetwork: process.env.SHIPMENT_APV_PAYOUT_ALERT_ALLOW_PRIVATE_NETWORK === "true",
  };
  assertDisputeModuleOutboundUrl(config.url, {
    label: "shipment APV payout alert",
    allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  return config;
}

export function evaluateShipmentApvPayoutAlert(
  health: ShipmentApvPayoutReservationHealth,
  policy: { expiredThreshold: number; approvalPendingThreshold?: number; approvalMaxAgeMinutes?: number },
  approvalHealth?: ShipmentApvPayoutCancellationApprovalHealth,
  invoiceStorageHealth?: ShipmentApvInvoiceDocumentStorageHealth,
  restorationStagingHealth?: ShipmentApvInvoiceRestorationStagingHealth,
  restorationRemediationHealth?: ShipmentApvInvoiceRestorationRemediationHealth,
  cursorRetentionJob?: ShipmentApvCursorRetentionMonitoring,
  now = new Date(),
): ShipmentApvAlertAssessment {
  const expiredReservation = health.expiredReserved >= policy.expiredThreshold;
  const approvalWaitingTooLong = Boolean(approvalHealth
    && approvalHealth.pendingRequests >= (policy.approvalPendingThreshold ?? 1)
    && (approvalHealth.oldestPendingAgeSeconds ?? 0) >= (policy.approvalMaxAgeMinutes ?? 15) * 60);
  const cursorRetentionAssessment = evaluateShipmentApvCursorRetentionAlert(cursorRetentionJob, now);
  const reasons = [
    ...(expiredReservation ? ["expired_reserved_payout"] : []),
    ...(approvalWaitingTooLong ? ["approval_waiting_too_long"] : []),
    ...(invoiceStorageHealth?.missingFiles ? ["invoice_document_missing"] : []),
    ...(invoiceStorageHealth?.hashMismatches ? ["invoice_document_hash_mismatch"] : []),
    ...(invoiceStorageHealth?.sizeMismatches ? ["invoice_document_size_mismatch"] : []),
    ...(invoiceStorageHealth?.orphanFiles ? ["invoice_document_orphan"] : []),
    ...(invoiceStorageHealth?.invalidEntries ? ["invoice_document_invalid_entry"] : []),
    ...(invoiceStorageHealth?.scanTruncated ? ["invoice_document_scan_truncated"] : []),
    ...(invoiceStorageHealth?.missingDocuments ? ["invoice_document_marked_missing"] : []),
    ...(invoiceStorageHealth?.quarantinedDocuments ? ["invoice_document_quarantined"] : []),
    ...(restorationStagingHealth?.pendingDisposition ? ["invoice_restoration_staging_pending"] : []),
    ...(restorationStagingHealth?.staleMoving ? ["invoice_restoration_staging_stale"] : []),
    ...(restorationStagingHealth?.missingSources ? ["invoice_restoration_staging_missing"] : []),
    ...(restorationStagingHealth?.hashMismatches ? ["invoice_restoration_staging_hash_mismatch"] : []),
    ...(restorationStagingHealth?.invalidEntries ? ["invoice_restoration_staging_invalid_entry"] : []),
    ...(restorationStagingHealth?.scanTruncated ? ["invoice_restoration_staging_scan_truncated"] : []),
    ...(restorationRemediationHealth?.expiringSoonRequests ? ["invoice_restoration_remediation_expiring"] : []),
    ...(restorationRemediationHealth?.overduePendingRequests ? ["invoice_restoration_remediation_overdue"] : []),
    ...(restorationRemediationHealth?.staleApplyingRequests ? ["invoice_restoration_remediation_stale_applying"] : []),
    ...(restorationRemediationHealth?.staleApplyingOver15Minutes
      ? ["invoice_restoration_remediation_stale_applying_15m"] : []),
    ...(restorationRemediationHealth?.staleApplyingOver60Minutes
      ? ["invoice_restoration_remediation_stale_applying_60m"] : []),
    ...(restorationRemediationHealth?.unacknowledgedStaleOver60Minutes
      ? ["invoice_restoration_remediation_unacknowledged_60m"] : []),
    ...(restorationRemediationHealth?.incidentUnlinkedStaleOver60Minutes
      ? ["invoice_restoration_remediation_incident_unlinked_60m"] : []),
    ...(restorationRemediationHealth?.acknowledgedStillApplyingOver30Minutes
      ? ["invoice_restoration_remediation_acknowledged_still_applying_30m"] : []),
    ...(restorationRemediationHealth?.incidentLinkedStillApplyingOver30Minutes
      ? ["invoice_restoration_remediation_incident_linked_still_applying_30m"] : []),
    ...(restorationRemediationHealth?.incidentLinkOverdueAfterAcknowledgment
      ? ["invoice_restoration_remediation_incident_link_overdue_after_ack_15m"] : []),
    ...cursorRetentionAssessment.reasons,
  ];
  const wouldAlert = reasons.length > 0;
  const critical = expiredReservation || approvalWaitingTooLong
    || Boolean(invoiceStorageHealth?.missingFiles || invoiceStorageHealth?.hashMismatches
      || invoiceStorageHealth?.missingDocuments);
  const stagingCritical = Boolean(restorationStagingHealth?.missingSources
    || restorationStagingHealth?.hashMismatches || restorationStagingHealth?.invalidEntries);
  const remediationCritical = Boolean(restorationRemediationHealth?.overduePendingRequests
    || restorationRemediationHealth?.staleApplyingRequests
    || restorationRemediationHealth?.staleApplyingOver15Minutes
    || restorationRemediationHealth?.staleApplyingOver60Minutes
    || restorationRemediationHealth?.unacknowledgedStaleOver60Minutes
    || restorationRemediationHealth?.incidentUnlinkedStaleOver60Minutes
    || restorationRemediationHealth?.acknowledgedStillApplyingOver30Minutes
    || restorationRemediationHealth?.incidentLinkedStillApplyingOver30Minutes
    || restorationRemediationHealth?.incidentLinkOverdueAfterAcknowledgment);
  return {
    wouldAlert,
    severity: critical || stagingCritical || remediationCritical
      || cursorRetentionAssessment.severity === "critical" ? "critical" : wouldAlert ? "warning" : null,
    reasons,
  };
}

export function evaluateShipmentApvCursorRetentionAlert(
  job: ShipmentApvCursorRetentionMonitoring | undefined,
  now = new Date(),
): ShipmentApvAlertAssessment {
  if (!job?.jobEnabled || !job.configured) return { wouldAlert: false, severity: null, reasons: [] };
  if (job.health.lastRunStatus === "FAILED") {
    return { wouldAlert: true, severity: "critical", reasons: ["invoice_restoration_cursor_retention_failed"] };
  }
  if (job.health.lastRunStatus === "STALE_RUNNING"
    || (job.health.lastRunStatus === "RUNNING" && job.health.leaseStale)) {
    return { wouldAlert: true, severity: "critical", reasons: ["invoice_restoration_cursor_retention_stale_running"] };
  }
  const firstObservedMs = job.health.firstObservedAt
    ? new Date(job.health.firstObservedAt).getTime() : Number.NaN;
  const overdueAfterMs = (job.intervalSeconds + 2 * 60 * 60) * 1000;
  if (job.health.lastRunStatus === "NEVER" && Number.isFinite(firstObservedMs)
    && now.getTime() - firstObservedMs > overdueAfterMs) {
    return { wouldAlert: true, severity: "warning", reasons: ["invoice_restoration_cursor_retention_never_started"] };
  }
  const lastSucceededMs = job.health.lastSucceededAt
    ? new Date(job.health.lastSucceededAt).getTime() : Number.NaN;
  if (job.health.lastRunStatus === "SUCCEEDED" && Number.isFinite(lastSucceededMs)
    && now.getTime() - lastSucceededMs > overdueAfterMs) {
    return { wouldAlert: true, severity: "warning", reasons: ["invoice_restoration_cursor_retention_success_overdue"] };
  }
  return { wouldAlert: false, severity: null, reasons: [] };
}

export async function sendShipmentApvPayoutAlert(
  health: ShipmentApvPayoutReservationHealth,
  assessment: ReturnType<typeof evaluateShipmentApvPayoutAlert>,
  options: {
    config: ShipmentApvPayoutAlertConfig;
    approvalHealth?: ShipmentApvPayoutCancellationApprovalHealth;
    invoiceStorageHealth?: ShipmentApvInvoiceDocumentStorageHealth;
    restorationStagingHealth?: ShipmentApvInvoiceRestorationStagingHealth;
    restorationRemediationHealth?: ShipmentApvInvoiceRestorationRemediationHealth;
    cursorRetentionJob?: ShipmentApvCursorRetentionMonitoring;
    fetchImpl?: typeof fetch;
    now?: Date;
  },
) {
  assertDisputeModuleOutboundUrl(options.config.url, {
    label: "shipment APV payout alert",
    allowInsecureHttp: options.config.allowInsecureHttp,
    allowPrivateNetwork: options.config.allowPrivateNetwork,
  });
  const timestamp = (options.now ?? new Date()).toISOString();
  const rawBody = JSON.stringify({
    type: "shipment_apv_payout_reservation.health",
    state: assessment.severity === "recovery" ? "recovered" : "firing",
    created_at: timestamp,
    severity: assessment.severity,
    reasons: assessment.reasons,
    health,
    cancellation_approval_health: options.approvalHealth ?? null,
    invoice_storage_health: options.invoiceStorageHealth ?? null,
    invoice_restoration_staging_health: options.restorationStagingHealth ?? null,
    invoice_restoration_remediation_health: options.restorationRemediationHealth ?? null,
    invoice_restoration_cursor_retention_job_health: options.cursorRetentionJob?.health ?? null,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.config.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(options.config.url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-haggle-alert-type": "shipment_apv_payout_reservation.health",
        "x-haggle-alert-timestamp": timestamp,
        "x-haggle-alert-signature": signWebhookClaimAlertPayload(options.config.secret, timestamp, rawBody),
      },
      body: rawBody,
    });
    return { status: response.ok ? "delivered" as const : "failed" as const, httpStatus: response.status };
  } catch (error) {
    return { status: "failed" as const, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}
