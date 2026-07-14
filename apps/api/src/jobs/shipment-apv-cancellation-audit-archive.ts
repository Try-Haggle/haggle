import type { Database } from "@haggle/db";
import { dispatchShipmentApvCancellationAuditArchives } from "../services/shipment-apv-payout-cancellation-audit-archive.service.js";

export async function runShipmentApvCancellationAuditArchive(db: Database) {
  const result = await dispatchShipmentApvCancellationAuditArchives(db);
  if (result.status === "processed" && result.claimed > 0) {
    const message = `[shipment-apv-cancellation-audit-archive] claimed=${result.claimed} delivered=${result.delivered} failed=${result.failed} dead_lettered=${result.deadLettered}`;
    if (result.deadLettered > 0) console.error(message);
    else console.log(message);
  }
  return result;
}
