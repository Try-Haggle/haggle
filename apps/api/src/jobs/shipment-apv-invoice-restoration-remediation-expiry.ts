import type { Database } from "@haggle/db";
import { expireShipmentApvInvoiceRestorationRemediations } from "../services/shipment-apv-invoice-restoration-remediation.service.js";

function boundedLimit(raw: string | undefined) {
  const value = Number(raw ?? "100");
  return Number.isInteger(value) && value >= 1 && value <= 1000 ? value : 100;
}

export function getShipmentApvInvoiceRestorationRemediationExpiryJobStatus() {
  return {
    jobEnabled:
      process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_JOB === "true",
    limit: boundedLimit(process.env.SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_LIMIT),
    intervalSeconds: 60,
    staleApplyingSeconds: 300,
  };
}

export async function runShipmentApvInvoiceRestorationRemediationExpiry(
  db: Database,
  options: {
    now?: Date;
    limit?: number;
  } = {},
) {
  const status = getShipmentApvInvoiceRestorationRemediationExpiryJobStatus();
  const expiry = await expireShipmentApvInvoiceRestorationRemediations(db, {
    now: options.now,
    limit: options.limit ?? status.limit,
  });
  return {
    status: expiry.expired ? ("completed" as const) : ("skipped" as const),
    reason: expiry.expired ? undefined : ("healthy" as const),
    expiry,
  };
}
