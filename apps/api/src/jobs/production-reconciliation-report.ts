/**
 * Report-only production reconciliation job.
 *
 * This job never mutates payment, order, shipment, refund, or dispute state.
 * It is intentionally disabled unless ENABLE_PRODUCTION_RECONCILIATION_JOB=true.
 */

import type { Database } from "@haggle/db";
import {
  buildProductionReconciliationReport,
  collectProductionReconciliationInput,
} from "../services/production-reconciliation.service.js";

export async function runProductionReconciliationReport(db: Database): Promise<void> {
  const input = await collectProductionReconciliationInput(db, {
    limit: Number(process.env.PRODUCTION_RECONCILIATION_LIMIT ?? 200),
  });
  const report = buildProductionReconciliationReport(input);

  if (report.summary.total === 0) {
    return;
  }

  const message = [
    `[production-reconciliation] report_only=true`,
    `critical=${report.summary.critical}`,
    `warning=${report.summary.warning}`,
    `payments=${report.summary.payments}`,
    `shipments=${report.summary.shipments}`,
    `disputes=${report.summary.disputes}`,
  ].join(" ");

  const topActions = report.nextActions.slice(0, 3);
  console.warn(message);
  if (topActions.length > 0) {
    console.warn(`[production-reconciliation] next_actions=${JSON.stringify(topActions)}`);
  }
}
