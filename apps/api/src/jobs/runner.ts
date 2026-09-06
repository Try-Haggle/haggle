/**
 * Cron job runner infrastructure.
 *
 * Uses setInterval-based scheduling (no external dependencies).
 * Only starts if ENABLE_CRON=true environment variable is set.
 *
 * Each job is a standalone async function wrapped in try-catch
 * so one failing job never takes down others.
 */

import type { Database } from "@haggle/db";
import { resolveApiRateLimitConfigFromEnv } from "../lib/api-rate-limit.js";
import { runApiRateLimitRetention } from "./api-rate-limit-retention.js";
import { runChainEventSync } from "./chain-event-sync.js";
import { runConditionalSettlementFinalityAlert } from "./conditional-settlement-finality-alert.js";
import { runConditionalSettlementPreflightAlert } from "./conditional-settlement-preflight-alert.js";
import { runDisputeAiAuditArchive } from "./dispute-ai-audit-archive.js";
import { runDisputeAiAuditArchiveAlert } from "./dispute-ai-audit-archive-alert.js";
import { runDisputeDepositExpiry } from "./dispute-deposit-expiry.js";
import { runDisputeEvidenceProvenanceArchive } from "./dispute-evidence-provenance-archive.js";
import { runDisputeEvidenceProvenanceArchiveAlert } from "./dispute-evidence-provenance-archive-alert.js";
import { runDisputeEvidenceRetention } from "./dispute-evidence-retention.js";
import { runDisputeEvidenceScanRetryJob } from "./dispute-evidence-scan-retry.js";
import { runDisputeEvidenceScanRetryAlertJob } from "./dispute-evidence-scan-retry-alert.js";
import { runDisputeEvidenceScanRetryAlertSnapshotRetentionJob } from "./dispute-evidence-scan-retry-alert-snapshot-retention.js";
import { runDisputeModuleWebhookOutbox } from "./dispute-module-webhook-outbox.js";
import { runDisputePrecedentCollection } from "./dispute-precedent-collection.js";
import { runDisputeSimilarityReviewAlert } from "./dispute-similarity-review-alert.js";
import { runDisputeSimilarityReviewAuditArchive } from "./dispute-similarity-review-audit-archive.js";
import { runDisputeSimilarityReviewAuditArchiveAlert } from "./dispute-similarity-review-audit-archive-alert.js";
import { runDisputeSimilarityReviewExpiry } from "./dispute-similarity-review-expiry.js";
import { runListingWithdrawRetention } from "./listing-withdraw-retention.js";
import { runPaymentIntentExpiry } from "./payment-intent-expiry.js";
import { runPaymentReconciliationReport } from "./payment-reconciliation-report.js";
import { runProductionReconciliationReport } from "./production-reconciliation-report.js";
import { runRetryFailedEmails } from "./retry-failed-emails.js";
import { runSettlementAutoRelease } from "./settlement-auto-release.js";
import { runShipmentApvCancellationAuditArchive } from "./shipment-apv-cancellation-audit-archive.js";
import { runShipmentApvCancellationAuditArchiveAlert } from "./shipment-apv-cancellation-audit-archive-alert.js";
import { runShipmentApvInvoiceRestorationRemediationExpiry } from "./shipment-apv-invoice-restoration-remediation-expiry.js";
import { runShipmentApvInvoiceRestorationStagingMaintenance } from "./shipment-apv-invoice-restoration-staging-maintenance.js";
import { runShipmentApvPayoutAlert } from "./shipment-apv-payout-alert.js";
import { runShipmentApvRemediationCursorRetention } from "./shipment-apv-remediation-cursor-retention.js";
import { runShipmentSlaCheck } from "./shipment-sla-check.js";
import { runWebhookClaimHealthAlert } from "./webhook-claim-health-alert.js";
import { runWebSocketAuthTicketRetention } from "./websocket-auth-ticket-retention.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJob {
  name: string;
  /** Interval in milliseconds */
  intervalMs: number;
  handler: (db: Database) => Promise<void>;
  enabled: boolean;
  runOnStart?: boolean;
}

// ---------------------------------------------------------------------------
// Job Registry
// ---------------------------------------------------------------------------

export function buildJobRegistry(): CronJob[] {
  const apiRateLimitConfig = resolveApiRateLimitConfigFromEnv();
  return [
    {
      name: "websocket-auth-ticket-retention",
      intervalMs: 5 * 60 * 1000,
      handler: async (db) => {
        await runWebSocketAuthTicketRetention(db);
      },
      enabled: true,
      runOnStart: true,
    },
    {
      name: "listing-withdraw-retention",
      intervalMs: 24 * 60 * 60 * 1000,
      handler: async (db) => {
        await runListingWithdrawRetention(db);
      },
      enabled: true,
      runOnStart: true,
    },
    {
      name: "api-rate-limit-retention",
      intervalMs: 60 * 60 * 1000,
      handler: async (db) => {
        await runApiRateLimitRetention(db);
      },
      enabled: apiRateLimitConfig.mode === "postgres",
      runOnStart: true,
    },
    {
      name: "settlement-auto-release",
      intervalMs: 5 * 60 * 1000, // every 5 minutes
      handler: runSettlementAutoRelease,
      enabled: true,
    },
    {
      name: "payment-intent-expiry",
      intervalMs: 15 * 60 * 1000, // every 15 minutes
      handler: runPaymentIntentExpiry,
      enabled: true,
    },
    {
      name: "shipment-sla-check",
      intervalMs: 15 * 60 * 1000, // every 15 minutes
      handler: runShipmentSlaCheck,
      enabled: true,
    },
    {
      name: "dispute-deposit-expiry",
      intervalMs: 60 * 60 * 1000, // every hour
      handler: runDisputeDepositExpiry,
      enabled: true,
    },
    {
      name: "chain-event-sync",
      intervalMs: 60 * 1000, // every 60 seconds
      handler: runChainEventSync,
      enabled: true,
    },
    {
      name: "retry-failed-emails",
      intervalMs: 5 * 60 * 1000, // every 5 minutes
      handler: runRetryFailedEmails,
      enabled: true,
    },
    {
      name: "dispute-module-webhook-outbox",
      intervalMs: 30 * 1000, // every 30 seconds
      handler: runDisputeModuleWebhookOutbox,
      enabled: true,
    },
    {
      name: "dispute-precedent-collection",
      intervalMs: 24 * 60 * 60 * 1000,
      handler: async (db) => {
        await runDisputePrecedentCollection(db);
      },
      enabled: process.env.ENABLE_DISPUTE_PRECEDENT_COLLECTION_JOB === "true",
      runOnStart: true,
    },
    {
      name: "dispute-evidence-retention",
      intervalMs: 60 * 60 * 1000,
      handler: async (db) => {
        await runDisputeEvidenceRetention(db);
      },
      enabled: process.env.ENABLE_DISPUTE_EVIDENCE_RETENTION_JOB === "true",
    },
    {
      name: "dispute-evidence-scan-retry",
      intervalMs: 30 * 1000,
      handler: async (db) => {
        await runDisputeEvidenceScanRetryJob(db);
      },
      enabled: process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB === "true",
    },
    {
      name: "dispute-evidence-scan-retry-alert",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runDisputeEvidenceScanRetryAlertJob(db);
      },
      enabled: process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB === "true",
    },
    {
      name: "dispute-evidence-scan-retry-alert-snapshot-retention",
      intervalMs: 24 * 60 * 60 * 1000,
      handler: async (db) => {
        await runDisputeEvidenceScanRetryAlertSnapshotRetentionJob(db);
      },
      enabled: process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB === "true",
      runOnStart: true,
    },
    {
      name: "production-reconciliation-report",
      intervalMs: 60 * 60 * 1000, // every hour
      handler: runProductionReconciliationReport,
      enabled: process.env.ENABLE_PRODUCTION_RECONCILIATION_JOB === "true",
    },
    {
      name: "payment-reconciliation-report",
      intervalMs: 60 * 60 * 1000, // every hour
      handler: runPaymentReconciliationReport,
      enabled: process.env.ENABLE_PAYMENT_RECONCILIATION_REPORT_JOB === "true",
    },
    {
      name: "webhook-claim-health-alert",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runWebhookClaimHealthAlert(db);
      },
      enabled: process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB === "true",
    },
    {
      name: "shipment-apv-payout-alert",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runShipmentApvPayoutAlert(db);
      },
      enabled: process.env.ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB === "true",
    },
    {
      name: "shipment-apv-invoice-restoration-staging-maintenance",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runShipmentApvInvoiceRestorationStagingMaintenance(db);
      },
      enabled: process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB === "true",
    },
    {
      name: "shipment-apv-invoice-restoration-remediation-expiry",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runShipmentApvInvoiceRestorationRemediationExpiry(db);
      },
      enabled:
        process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_JOB === "true",
    },
    {
      name: "shipment-apv-remediation-cursor-retention",
      intervalMs: 24 * 60 * 60 * 1000,
      handler: async (db) => {
        await runShipmentApvRemediationCursorRetention(db);
      },
      enabled: process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB === "true",
      runOnStart: true,
    },
    {
      name: "shipment-apv-cancellation-audit-archive",
      intervalMs: 30 * 1000,
      handler: async (db) => {
        await runShipmentApvCancellationAuditArchive(db);
      },
      enabled: process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB === "true",
    },
    {
      name: "shipment-apv-cancellation-audit-archive-alert",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runShipmentApvCancellationAuditArchiveAlert(db);
      },
      enabled: process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB === "true",
    },
    {
      name: "dispute-similarity-review-alert",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runDisputeSimilarityReviewAlert(db);
      },
      enabled: process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB === "true",
    },
    {
      name: "dispute-similarity-review-expiry",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runDisputeSimilarityReviewExpiry(db);
      },
      enabled: process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB === "true",
    },
    {
      name: "dispute-similarity-review-audit-archive",
      intervalMs: 30 * 1000,
      handler: async (db) => {
        await runDisputeSimilarityReviewAuditArchive(db);
      },
      enabled: process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB === "true",
    },
    {
      name: "dispute-similarity-review-audit-archive-alert",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runDisputeSimilarityReviewAuditArchiveAlert(db);
      },
      enabled: process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB === "true",
    },
    {
      name: "dispute-ai-audit-archive",
      intervalMs: 30 * 1000,
      handler: async (db) => {
        await runDisputeAiAuditArchive(db);
      },
      enabled: process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB === "true",
    },
    {
      name: "dispute-ai-audit-archive-alert",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runDisputeAiAuditArchiveAlert(db);
      },
      enabled: process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB === "true",
    },
    {
      name: "dispute-evidence-provenance-archive",
      intervalMs: 30 * 1000,
      handler: async (db) => {
        await runDisputeEvidenceProvenanceArchive(db);
      },
      enabled: process.env.ENABLE_DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_JOB === "true",
    },
    {
      name: "conditional-settlement-preflight-alert",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runConditionalSettlementPreflightAlert(db);
      },
      enabled: process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB === "true",
    },
    {
      name: "conditional-settlement-finality-alert",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runConditionalSettlementFinalityAlert(db);
      },
      enabled: process.env.ENABLE_CONDITIONAL_SETTLEMENT_FINALITY_ALERT_JOB === "true",
    },
    {
      name: "dispute-evidence-provenance-archive-alert",
      intervalMs: 60 * 1000,
      handler: async (db) => {
        await runDisputeEvidenceProvenanceArchiveAlert(db);
      },
      enabled: process.env.ENABLE_DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_ALERT_JOB === "true",
    },
  ];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const activeTimers: ReturnType<typeof setInterval>[] = [];
const runningJobs = new Set<string>();

async function executeCronJob(job: CronJob, db: Database) {
  if (runningJobs.has(job.name)) {
    console.log(`[cron] ${job.name} still running, skipping`);
    return;
  }
  runningJobs.add(job.name);
  const start = Date.now();
  try {
    await job.handler(db);
    const elapsed = Date.now() - start;
    if (elapsed > 5000) console.log(`[cron] ${job.name} completed in ${elapsed}ms`);
  } catch (error) {
    console.error(
      `[cron] ${job.name} FAILED:`,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    runningJobs.delete(job.name);
  }
}

/**
 * Initialize and start all cron jobs.
 * No-op if ENABLE_CRON !== "true".
 */
export function initCronJobs(db: Database): void {
  if (process.env.ENABLE_CRON !== "true") {
    console.log("[cron] ENABLE_CRON is not set to 'true' — cron jobs disabled");
    return;
  }

  const jobs = buildJobRegistry();
  const enabledJobs = jobs.filter((j) => j.enabled);

  console.log(
    `[cron] Starting ${enabledJobs.length} job(s): ${enabledJobs.map((j) => j.name).join(", ")}`,
  );

  for (const job of enabledJobs) {
    if (job.runOnStart) void executeCronJob(job, db);
    const timer = setInterval(() => {
      void executeCronJob(job, db);
    }, job.intervalMs);

    // Allow process to exit even if timers are pending
    timer.unref();
    activeTimers.push(timer);
  }
}

/**
 * Stop all running cron jobs. Useful for graceful shutdown and tests.
 */
export function stopCronJobs(): void {
  for (const timer of activeTimers) {
    clearInterval(timer);
  }
  activeTimers.length = 0;
  console.log("[cron] All cron jobs stopped");
}
