import type { Database } from "@haggle/db";
import { maintainShipmentApvInvoiceRestorationStaging } from "../services/shipment-apv-invoice-restoration.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedLimit(raw: string | undefined) {
  const value = Number(raw ?? "100");
  return Number.isInteger(value) && value >= 1 && value <= 1000 ? value : 100;
}

export function getShipmentApvInvoiceRestorationStagingMaintenanceJobStatus() {
  const actorId = process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_ACTOR_ID ?? "";
  return {
    jobEnabled: process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB === "true",
    configured: UUID_PATTERN.test(actorId),
    limit: boundedLimit(process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_LIMIT),
    intervalSeconds: 60,
    staleResumeSeconds: 300,
  };
}

export async function runShipmentApvInvoiceRestorationStagingMaintenance(
  db: Database,
  options: {
    actorId?: string;
    limit?: number;
    storageRoot?: string;
    now?: Date;
  } = {},
) {
  const actorId =
    options.actorId ?? process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_ACTOR_ID ?? "";
  const status = getShipmentApvInvoiceRestorationStagingMaintenanceJobStatus();
  if (!UUID_PATTERN.test(actorId))
    return { status: "skipped" as const, reason: "not_configured" as const };
  const maintenance = await maintainShipmentApvInvoiceRestorationStaging(db, {
    mode: "apply",
    actorId,
    limit: options.limit ?? status.limit,
    storageRoot: options.storageRoot,
    now: options.now,
  });
  if ("outcome" in maintenance)
    throw new Error("APV_INVOICE_RESTORATION_MAINTENANCE_INVALID_CONFIG");
  return {
    status: maintenance.eligible === 0 ? ("skipped" as const) : ("completed" as const),
    reason: maintenance.eligible === 0 ? ("healthy" as const) : undefined,
    maintenance,
  };
}
