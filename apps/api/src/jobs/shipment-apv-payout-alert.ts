import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import { isProductionRuntime } from "../config/runtime.js";
import { getShipmentApvInvoiceDocumentStorageHealth } from "../services/shipment-apv-invoice-document.service.js";
import { getShipmentApvInvoiceRestorationStagingHealth } from "../services/shipment-apv-invoice-restoration.service.js";
import { getShipmentApvInvoiceRestorationRemediationHealth } from "../services/shipment-apv-invoice-restoration-remediation.service.js";
import {
  evaluateShipmentApvPayoutAlert,
  resolveShipmentApvPayoutAlertConfigFromEnv,
  type ShipmentApvPayoutAlertConfig,
  sendShipmentApvPayoutAlert,
} from "../services/shipment-apv-payout-alert.service.js";
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
  webhookPayloadSha256,
} from "../services/webhook-event-claim.service.js";
import {
  getShipmentApvRemediationCursorRetentionJobHealth,
  getShipmentApvRemediationCursorRetentionJobStatus,
} from "./shipment-apv-remediation-cursor-retention.js";

const ALERT_SOURCE = "haggle-shipment-apv-payout-alert";

export async function runShipmentApvPayoutAlert(
  db: Database,
  options: {
    now?: Date;
    fetchImpl?: typeof fetch;
    fixture?: {
      alertSource: string;
      config: ShipmentApvPayoutAlertConfig;
      cursorRetentionStatus: ReturnType<typeof getShipmentApvRemediationCursorRetentionJobStatus>;
    };
  } = {},
) {
  if (options.fixture && isProductionRuntime()) {
    throw new Error("SHIPMENT_APV_ALERT_FIXTURE_FORBIDDEN_IN_PRODUCTION");
  }
  if (
    options.fixture &&
    !/^haggle-shipment-apv-payout-alert-fixture-[0-9a-f-]{36}$/.test(options.fixture.alertSource)
  ) {
    throw new Error("INVALID_SHIPMENT_APV_ALERT_FIXTURE_SOURCE");
  }
  const alertSource = options.fixture?.alertSource ?? ALERT_SOURCE;
  const config = options.fixture?.config ?? resolveShipmentApvPayoutAlertConfigFromEnv();
  if (!config) return { status: "skipped" as const, reason: "not_configured" as const };
  const now = options.now ?? new Date();
  const health = await getShipmentApvPayoutReservationHealth(db, now);
  const approvalHealth = await getShipmentApvPayoutCancellationApprovalHealth(db, now);
  const invoiceStorageHealth = await getShipmentApvInvoiceDocumentStorageHealth(db);
  const restorationStagingHealth = await getShipmentApvInvoiceRestorationStagingHealth(db, { now });
  const restorationRemediationHealth = await getShipmentApvInvoiceRestorationRemediationHealth(
    db,
    now,
  );
  const cursorRetentionStatus =
    options.fixture?.cursorRetentionStatus ?? getShipmentApvRemediationCursorRetentionJobStatus();
  const cursorRetentionJob =
    cursorRetentionStatus.jobEnabled && cursorRetentionStatus.configured
      ? {
          ...cursorRetentionStatus,
          health: await getShipmentApvRemediationCursorRetentionJobHealth(db, now),
        }
      : undefined;
  let assessment = evaluateShipmentApvPayoutAlert(
    health,
    config,
    approvalHealth,
    invoiceStorageHealth,
    restorationStagingHealth,
    restorationRemediationHealth,
    cursorRetentionJob,
    now,
  );
  let eventPrefix = "health";
  let incidentKey = "";
  if (!assessment.wouldAlert) {
    const deliveryState = await getWebhookClaimAlertDeliveryState(db, alertSource);
    if (!deliveryState.incidentOpen) {
      return {
        status: "skipped" as const,
        reason: "healthy" as const,
        health,
        approvalHealth,
        invoiceStorageHealth,
        restorationStagingHealth,
        restorationRemediationHealth,
        cursorRetentionJob,
        assessment,
        deliveryState,
      };
    }
    const incident = await findLatestDeliveredWebhookClaimIncident(db, alertSource);
    if (!incident) {
      return {
        status: "skipped" as const,
        reason: "healthy" as const,
        health,
        approvalHealth,
        invoiceStorageHealth,
        restorationStagingHealth,
        restorationRemediationHealth,
        cursorRetentionJob,
        assessment,
        deliveryState,
      };
    }
    assessment = { wouldAlert: false, severity: "recovery", reasons: [] };
    eventPrefix = "recovery";
    incidentKey = incident.eventId;
  }

  const bucket = Math.floor(now.getTime() / (config.cooldownMinutes * 60_000));
  const cooldownKey =
    eventPrefix === "recovery"
      ? `recovery:${incidentKey}`
      : `${assessment.severity}:${[...assessment.reasons].sort().join(",")}:${bucket}`;
  const eventId = `${eventPrefix}_${createHash("sha256").update(cooldownKey).digest("hex")}`;
  const claim = await claimWebhookEvent(db, {
    source: alertSource,
    eventId,
    payloadSha256: webhookPayloadSha256(cooldownKey),
  });
  if (claim.outcome !== "acquired") {
    return {
      status: "skipped" as const,
      reason: "cooldown_or_in_progress" as const,
      health,
      approvalHealth,
      invoiceStorageHealth,
      restorationStagingHealth,
      restorationRemediationHealth,
      cursorRetentionJob,
      assessment,
    };
  }
  try {
    const alert = await sendShipmentApvPayoutAlert(health, assessment, {
      config,
      approvalHealth,
      invoiceStorageHealth,
      restorationStagingHealth,
      restorationRemediationHealth,
      cursorRetentionJob,
      fetchImpl: options.fetchImpl,
      now,
    });
    if (alert.status === "delivered") {
      await completeWebhookEvent(db, claim, alert.httpStatus ?? 200);
      return {
        status: "delivered" as const,
        health,
        approvalHealth,
        invoiceStorageHealth,
        restorationStagingHealth,
        restorationRemediationHealth,
        cursorRetentionJob,
        assessment,
        alert,
      };
    }
    await failWebhookEvent(db, claim);
    return {
      status: "failed" as const,
      health,
      approvalHealth,
      invoiceStorageHealth,
      restorationStagingHealth,
      restorationRemediationHealth,
      cursorRetentionJob,
      assessment,
      alert,
    };
  } catch (error) {
    await failWebhookEvent(db, claim);
    throw error;
  }
}
