/**
 * Dedicated payment ledger reconciliation report-only job.
 *
 * Local order ↔ intent ↔ refund ↔ release mismatches always run.
 * Provider compare runs only when PAYMENT_RECONCILIATION_INCLUDE_PROVIDER_COMPARE=true
 * and injected provider snapshots are supplied by the caller (cron path uses none).
 *
 * Never mutates payment, order, refund, or settlement-release state.
 * Disabled unless ENABLE_PAYMENT_RECONCILIATION_REPORT_JOB=true.
 */

import type { Database } from "@haggle/db";
import {
  buildPaymentReconciliationReport,
  collectPaymentReconciliationInput,
  emitPaymentReconciliationMetrics,
} from "../services/payment-reconciliation-report.service.js";

export async function runPaymentReconciliationReport(db: Database): Promise<void> {
  const limit = Number(process.env.PAYMENT_RECONCILIATION_REPORT_LIMIT ?? 200);
  const includeProviderCompare =
    process.env.PAYMENT_RECONCILIATION_INCLUDE_PROVIDER_COMPARE === "true";

  const input = await collectPaymentReconciliationInput(db, { limit });
  const report = buildPaymentReconciliationReport({
    generatedAt: input.generatedAt,
    ledger: input.ledger,
    localPayments: input.localPayments,
    providerPayments: input.providerPayments,
    // Cron has no provider adapter yet; keep optional and off by default to avoid
    // false local_captured_provider_not_captured noise against an empty provider set.
    runProviderCompare: includeProviderCompare && input.providerPayments.length > 0,
  });

  await emitPaymentReconciliationMetrics(report);

  if (report.summary.total === 0) {
    return;
  }

  const message = [
    `[payment-reconciliation] report_only=true`,
    `critical=${report.summary.critical}`,
    `warning=${report.summary.warning}`,
    `local_ledger=${report.summary.local_ledger}`,
    `provider=${report.summary.provider}`,
  ].join(" ");

  console.warn(message);
  const topActions = report.nextActions.slice(0, 3);
  if (topActions.length > 0) {
    console.warn(`[payment-reconciliation] next_actions=${JSON.stringify(topActions)}`);
  }
}
