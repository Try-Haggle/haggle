import { afterEach, describe, expect, it } from "vitest";
import { buildJobRegistry } from "../jobs/runner.js";

const originalEnabled = process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB;
const originalApvEnabled = process.env.ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB;
const originalAuditArchiveEnabled = process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB;
const originalAuditArchiveAlertEnabled =
  process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB;
const originalSimilarityAlertEnabled = process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB;
const originalSimilarityExpiryEnabled = process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB;
const originalSimilarityArchiveEnabled =
  process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB;
const originalSimilarityArchiveAlertEnabled =
  process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB;
const originalDisputeAiArchiveEnabled = process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB;
const originalDisputeAiArchiveAlertEnabled = process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB;
const originalConditionalPreflightAlertEnabled =
  process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB;
const originalRestorationMaintenanceEnabled =
  process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB;
const originalCursorRetentionEnabled =
  process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB;
const originalEvidenceScanRetryEnabled = process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB;
const originalEvidenceScanRetryAlertEnabled =
  process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB;

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB;
  else process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB = originalEnabled;
  if (originalApvEnabled === undefined) delete process.env.ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB;
  else process.env.ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB = originalApvEnabled;
  if (originalAuditArchiveEnabled === undefined)
    delete process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB;
  else process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB = originalAuditArchiveEnabled;
  if (originalAuditArchiveAlertEnabled === undefined)
    delete process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB;
  else
    process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB =
      originalAuditArchiveAlertEnabled;
  if (originalSimilarityAlertEnabled === undefined)
    delete process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB;
  else process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB = originalSimilarityAlertEnabled;
  if (originalSimilarityExpiryEnabled === undefined)
    delete process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB;
  else process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB = originalSimilarityExpiryEnabled;
  if (originalSimilarityArchiveEnabled === undefined)
    delete process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB;
  else
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB =
      originalSimilarityArchiveEnabled;
  if (originalSimilarityArchiveAlertEnabled === undefined)
    delete process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB;
  else
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB =
      originalSimilarityArchiveAlertEnabled;
  if (originalDisputeAiArchiveEnabled === undefined)
    delete process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB;
  else process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB = originalDisputeAiArchiveEnabled;
  if (originalDisputeAiArchiveAlertEnabled === undefined)
    delete process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB;
  else process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB = originalDisputeAiArchiveAlertEnabled;
  if (originalConditionalPreflightAlertEnabled === undefined)
    delete process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB;
  else
    process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB =
      originalConditionalPreflightAlertEnabled;
  if (originalRestorationMaintenanceEnabled === undefined)
    delete process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB;
  else
    process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB =
      originalRestorationMaintenanceEnabled;
  if (originalCursorRetentionEnabled === undefined)
    delete process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB;
  else
    process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB =
      originalCursorRetentionEnabled;
  if (originalEvidenceScanRetryEnabled === undefined) {
    delete process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB;
  } else {
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB = originalEvidenceScanRetryEnabled;
  }
  if (originalEvidenceScanRetryAlertEnabled === undefined) {
    delete process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB;
  } else {
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB =
      originalEvidenceScanRetryAlertEnabled;
  }
});

describe("cron job registry", () => {
  it("registers seller-deleted listing purge once a day", () => {
    expect(
      buildJobRegistry().find((job) => job.name === "listing-withdraw-retention"),
    ).toMatchObject({
      enabled: true,
      runOnStart: true,
      intervalMs: 86_400_000,
    });
  });

  it("registers evidence scan retries every 30 seconds only when enabled", () => {
    delete process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-evidence-scan-retry"),
    ).toMatchObject({ intervalMs: 30_000, enabled: false });
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-evidence-scan-retry"),
    ).toMatchObject({ intervalMs: 30_000, enabled: true });
  });

  it("registers evidence scan retry alerts every minute only when enabled", () => {
    delete process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-evidence-scan-retry-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: false });
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-evidence-scan-retry-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: true });
  });

  it("registers alert snapshot retention daily with the alert job", () => {
    delete process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB;
    expect(
      buildJobRegistry().find(
        (job) => job.name === "dispute-evidence-scan-retry-alert-snapshot-retention",
      ),
    ).toMatchObject({ intervalMs: 86_400_000, enabled: false, runOnStart: true });
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB = "true";
    expect(
      buildJobRegistry().find(
        (job) => job.name === "dispute-evidence-scan-retry-alert-snapshot-retention",
      ),
    ).toMatchObject({ intervalMs: 86_400_000, enabled: true, runOnStart: true });
  });
  it("registers webhook claim alert checks every minute only when enabled", () => {
    delete process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "webhook-claim-health-alert"),
    ).toMatchObject({
      intervalMs: 60_000,
      enabled: false,
    });
    process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "webhook-claim-health-alert"),
    ).toMatchObject({
      intervalMs: 60_000,
      enabled: true,
    });
  });

  it("registers APV payout reservation alert checks every minute only when enabled", () => {
    delete process.env.ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "shipment-apv-payout-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: false });
    process.env.ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "shipment-apv-payout-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: true });
  });

  it("registers APV restoration staging maintenance every minute only when enabled", () => {
    delete process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB;
    expect(
      buildJobRegistry().find(
        (job) => job.name === "shipment-apv-invoice-restoration-staging-maintenance",
      ),
    ).toMatchObject({ intervalMs: 60_000, enabled: false });
    process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB = "true";
    expect(
      buildJobRegistry().find(
        (job) => job.name === "shipment-apv-invoice-restoration-staging-maintenance",
      ),
    ).toMatchObject({ intervalMs: 60_000, enabled: true });
  });

  it("registers APV cursor retention daily only when enabled", () => {
    delete process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "shipment-apv-remediation-cursor-retention"),
    ).toMatchObject({ intervalMs: 86_400_000, enabled: false });
    process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "shipment-apv-remediation-cursor-retention"),
    ).toMatchObject({ intervalMs: 86_400_000, enabled: true, runOnStart: true });
  });

  it("registers APV cancellation audit archive dispatch every 30 seconds only when enabled", () => {
    delete process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "shipment-apv-cancellation-audit-archive"),
    ).toMatchObject({ intervalMs: 30_000, enabled: false });
    process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "shipment-apv-cancellation-audit-archive"),
    ).toMatchObject({ intervalMs: 30_000, enabled: true });
  });

  it("registers APV audit archive health alerts every minute only when enabled", () => {
    delete process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB;
    expect(
      buildJobRegistry().find(
        (job) => job.name === "shipment-apv-cancellation-audit-archive-alert",
      ),
    ).toMatchObject({ intervalMs: 60_000, enabled: false });
    process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB = "true";
    expect(
      buildJobRegistry().find(
        (job) => job.name === "shipment-apv-cancellation-audit-archive-alert",
      ),
    ).toMatchObject({ intervalMs: 60_000, enabled: true });
  });

  it("registers similarity review SLA alerts every minute only when enabled", () => {
    delete process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-similarity-review-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: false });
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-similarity-review-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: true });
  });

  it("registers similarity review expiry every minute only when enabled", () => {
    delete process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-similarity-review-expiry"),
    ).toMatchObject({ intervalMs: 60_000, enabled: false });
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-similarity-review-expiry"),
    ).toMatchObject({ intervalMs: 60_000, enabled: true });
  });

  it("registers similarity review WORM archive every 30 seconds only when enabled", () => {
    delete process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-similarity-review-audit-archive"),
    ).toMatchObject({ intervalMs: 30_000, enabled: false });
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-similarity-review-audit-archive"),
    ).toMatchObject({ intervalMs: 30_000, enabled: true });
  });

  it("registers similarity review WORM archive alerts every minute only when enabled", () => {
    delete process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB;
    expect(
      buildJobRegistry().find(
        (job) => job.name === "dispute-similarity-review-audit-archive-alert",
      ),
    ).toMatchObject({ intervalMs: 60_000, enabled: false });
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB = "true";
    expect(
      buildJobRegistry().find(
        (job) => job.name === "dispute-similarity-review-audit-archive-alert",
      ),
    ).toMatchObject({ intervalMs: 60_000, enabled: true });
  });

  it("registers dispute AI audit WORM archive every 30 seconds only when enabled", () => {
    delete process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB;
    expect(buildJobRegistry().find((job) => job.name === "dispute-ai-audit-archive")).toMatchObject(
      { intervalMs: 30_000, enabled: false },
    );
    process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB = "true";
    expect(buildJobRegistry().find((job) => job.name === "dispute-ai-audit-archive")).toMatchObject(
      { intervalMs: 30_000, enabled: true },
    );
  });

  it("registers dispute AI audit archive alerts every minute only when enabled", () => {
    delete process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-ai-audit-archive-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: false });
    process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-ai-audit-archive-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: true });
  });

  it("registers conditional settlement preflight alerts every minute only when enabled", () => {
    delete process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "conditional-settlement-preflight-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: false });
    process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "conditional-settlement-preflight-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: true });
  });

  it("registers conditional settlement finality alerts every minute only when enabled", () => {
    delete process.env.ENABLE_CONDITIONAL_SETTLEMENT_FINALITY_ALERT_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "conditional-settlement-finality-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: false });
    process.env.ENABLE_CONDITIONAL_SETTLEMENT_FINALITY_ALERT_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "conditional-settlement-finality-alert"),
    ).toMatchObject({ intervalMs: 60_000, enabled: true });
  });
});
