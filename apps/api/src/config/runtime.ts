import { resolveAdvisorCanarySecret } from "../advisor/advisor-canary.js";
import { resolveConditionalSettlementFinalityAlertConfigFromEnv } from "../services/conditional-settlement-finality-alert.service.js";
import { resolveConditionalSettlementFinalityAlertReceiverSecretsFromEnv } from "../services/conditional-settlement-finality-alert-verifier.service.js";
import { resolveConditionalSettlementPreflightAlertConfigFromEnv } from "../services/conditional-settlement-preflight-alert.service.js";
import { resolveDisputeAiAuditArchiveAlertConfigFromEnv } from "../services/dispute-ai-audit-archive-alert.service.js";
import { resolveDisputeAuditPublicKeyRegistryFromEnv } from "../services/dispute-audit-public-key-registry.service.js";
import { resolveDisputeEvidenceProvenanceArchiveAlertConfigFromEnv } from "../services/dispute-evidence-provenance-archive-alert.service.js";
import { resolveDisputeEvidenceScannerConfigFromEnv } from "../services/dispute-evidence-scan.service.js";
import { resolveDisputeEvidenceScanRetryConfigFromEnv } from "../services/dispute-evidence-scan-retry.service.js";
import { resolveDisputeEvidenceScanRetryAlertConfigFromEnv } from "../services/dispute-evidence-scan-retry-alert.service.js";
import { resolveDisputeEvidenceScanRetryAlertReceiverSecretsFromEnv } from "../services/dispute-evidence-scan-retry-alert-verifier.service.js";
import { resolveDisputeEvidenceScannerCircuitConfigFromEnv } from "../services/dispute-evidence-scanner-circuit.service.js";
import { resolveDisputeSimilarityReviewAlertConfigFromEnv } from "../services/dispute-similarity-review-alert.service.js";
import { resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv } from "../services/dispute-similarity-review-audit-archive.service.js";
import { resolveDisputeSimilarityReviewAuditArchiveAlertConfigFromEnv } from "../services/dispute-similarity-review-audit-archive-alert.service.js";
import { validateTrustedHnpJwks } from "../services/hnp-jwks.service.js";
import { resolveShipmentApvPayoutAlertConfigFromEnv } from "../services/shipment-apv-payout-alert.service.js";
import { resolveShipmentApvCancellationAuditArchiveConfigFromEnv } from "../services/shipment-apv-payout-cancellation-audit-archive.service.js";
import { resolveShipmentApvCancellationAuditArchiveAlertConfigFromEnv } from "../services/shipment-apv-payout-cancellation-audit-archive-alert.service.js";
import { resolveSupabaseJwtConfigFromEnv } from "../services/supabase-jwt.service.js";
import { resolveWebhookClaimAlertConfigFromEnv } from "../services/webhook-claim-alert.service.js";
import { resolveWebhookClaimAlertReceiverSecretsFromEnv } from "../services/webhook-claim-alert-verifier.service.js";

const VALID_NODE_ENVS = new Set(["development", "test", "production"]);

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[CONFIG] ${name} is required. Set ${name} before starting the API server.`);
  }
  return value;
}

export function getNodeEnv(): "development" | "test" | "production" {
  const nodeEnv = readRequiredEnv("NODE_ENV");
  if (!VALID_NODE_ENVS.has(nodeEnv)) {
    throw new Error(
      `[CONFIG] NODE_ENV must be one of development, test, or production. Received: ${nodeEnv}`,
    );
  }
  return nodeEnv as "development" | "test" | "production";
}

export function isProductionRuntime(): boolean {
  return getNodeEnv() === "production" || process.env.VERCEL_ENV === "production";
}

export const DEFAULT_API_CORS_ORIGINS = [
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://grok.com",
  "https://www.grok.com",
  "https://grok.x.ai",
  "https://x.com",
  "https://accounts.x.ai",
  "https://tryhaggle.ai",
  "https://app.tryhaggle.ai",
  "https://app.staging.tryhaggle.ai",
] as const;

function parseCorsOrigins(rawOrigins: string | undefined): Set<string> {
  const origins = new Set<string>(DEFAULT_API_CORS_ORIGINS);

  for (const rawOrigin of rawOrigins?.split(",") ?? []) {
    const origin = rawOrigin.trim().replace(/\/$/, "");
    if (origin) origins.add(origin);
  }

  return origins;
}

export type HaggleEnv = "local" | "staging" | "production";

export interface RuntimeConfig {
  databaseUrl: string;
  isProduction: boolean;
  haggleEnv: HaggleEnv;
  publicAppUrl: string;
  corsAllowedOrigins: Set<string>;
}

function getHaggleEnv(): HaggleEnv {
  const raw = process.env.HAGGLE_ENV?.trim().toLowerCase();
  if (raw === "staging") return "staging";
  if (raw === "production") return "production";
  return "local";
}

function getPublicAppUrl(haggleEnv: HaggleEnv): string {
  if (process.env.PUBLIC_APP_URL?.trim()) return process.env.PUBLIC_APP_URL.trim();
  if (haggleEnv === "production") return "https://app.tryhaggle.ai";
  if (haggleEnv === "staging") return "https://app.staging.tryhaggle.ai";
  return "http://localhost:3000";
}

export function getRuntimeConfig(): RuntimeConfig {
  const isProduction = isProductionRuntime();
  const haggleEnv = getHaggleEnv();
  const publicAppUrl = getPublicAppUrl(haggleEnv);
  const databaseUrl = readRequiredEnv("DATABASE_URL");

  if (process.env.DEEPSEEK_API_KEY?.trim()) {
    try {
      resolveAdvisorCanarySecret();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid Advisor canary configuration: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  try {
    resolveSupabaseJwtConfigFromEnv();
  } catch (error) {
    throw new Error(
      `[CONFIG] Invalid Supabase JWT configuration: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (
    process.env.DISPUTE_EVIDENCE_SCANNER_URL?.trim() ||
    process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN ||
    process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_INSECURE_HTTP === "true" ||
    process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_PRIVATE_NETWORK === "true"
  ) {
    try {
      resolveDisputeEvidenceScannerConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid dispute evidence scanner configuration: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  try {
    const circuit = resolveDisputeEvidenceScannerCircuitConfigFromEnv();
    const scanner = resolveDisputeEvidenceScannerConfigFromEnv();
    if (scanner && circuit.permitLeaseSeconds * 1_000 < scanner.timeoutMs + 5_000) {
      throw new Error("scanner permit lease must exceed scanner timeout by at least 5 seconds");
    }
  } catch (error) {
    throw new Error(
      `[CONFIG] Invalid dispute evidence scanner circuit configuration: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  if (
    process.env.ENABLE_DISPUTE_PRECEDENT_COLLECTION_JOB === "true" &&
    process.env.ENABLE_CRON !== "true"
  ) {
    throw new Error(
      "[CONFIG] ENABLE_CRON=true is required when " +
        "ENABLE_DISPUTE_PRECEDENT_COLLECTION_JOB=true.",
    );
  }

  if (process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when " +
          "ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB=true.",
      );
    }
    try {
      const scanner = resolveDisputeEvidenceScannerConfigFromEnv();
      if (!scanner) {
        throw new Error("a configured scanner is required");
      }
      const retry = resolveDisputeEvidenceScanRetryConfigFromEnv();
      if (retry.leaseSeconds * 1_000 < scanner.timeoutMs + 5_000) {
        throw new Error("retry lease must exceed scanner timeout by at least 5 seconds");
      }
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid dispute evidence scan retry configuration: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  if (process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when " +
          "ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB=true.",
      );
    }
    if (process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB=true is required " +
          "when scan retry alerting is enabled.",
      );
    }
    if (
      isProduction &&
      (process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_ALLOW_INSECURE_HTTP === "true" ||
        process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_ALLOW_PRIVATE_NETWORK === "true")
    ) {
      throw new Error(
        "[CONFIG] scan retry alert local network overrides are forbidden " + "in production.",
      );
    }
    try {
      if (!resolveDisputeEvidenceScanRetryAlertConfigFromEnv()) {
        throw new Error("an alert URL is required");
      }
      const receiverSecrets = resolveDisputeEvidenceScanRetryAlertReceiverSecretsFromEnv();
      if (!receiverSecrets.length) {
        throw new Error("an alert receiver secret is required");
      }
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid dispute evidence scan retry alert configuration: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  if (
    process.env.WEBHOOK_CLAIM_ALERT_SECRET?.trim() ||
    process.env.WEBHOOK_CLAIM_ALERT_PREVIOUS_SECRETS?.trim()
  ) {
    try {
      resolveWebhookClaimAlertReceiverSecretsFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid webhook claim alert receiver configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  if (
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET?.trim() ||
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS?.trim()
  ) {
    try {
      resolveConditionalSettlementFinalityAlertReceiverSecretsFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid conditional settlement finality alert receiver configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  if (process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB=true.",
      );
    }
    if (!process.env.WEBHOOK_CLAIM_ALERT_URL?.trim()) {
      throw new Error(
        "[CONFIG] WEBHOOK_CLAIM_ALERT_URL is required when webhook claim alerting is enabled.",
      );
    }
    try {
      resolveWebhookClaimAlertConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid webhook claim alert configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (
      isProduction &&
      (process.env.WEBHOOK_CLAIM_ALERT_ALLOW_INSECURE_HTTP === "true" ||
        process.env.WEBHOOK_CLAIM_ALERT_ALLOW_PRIVATE_NETWORK === "true")
    ) {
      throw new Error(
        "[CONFIG] Webhook claim alert network safety overrides are forbidden in production.",
      );
    }
  }

  if (process.env.ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB=true.",
      );
    }
    if (!process.env.SHIPMENT_APV_PAYOUT_ALERT_URL?.trim()) {
      throw new Error(
        "[CONFIG] SHIPMENT_APV_PAYOUT_ALERT_URL is required when shipment APV payout alerting is enabled.",
      );
    }
    try {
      resolveShipmentApvPayoutAlertConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid shipment APV payout alert configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (
      isProduction &&
      (process.env.SHIPMENT_APV_PAYOUT_ALERT_ALLOW_INSECURE_HTTP === "true" ||
        process.env.SHIPMENT_APV_PAYOUT_ALERT_ALLOW_PRIVATE_NETWORK === "true")
    ) {
      throw new Error(
        "[CONFIG] Shipment APV payout alert network safety overrides are forbidden in production.",
      );
    }
  }

  if (process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB=true.",
      );
    }
    const actorId = process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_ACTOR_ID?.trim() ?? "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)
    ) {
      throw new Error(
        "[CONFIG] SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_ACTOR_ID must be a UUID when restoration maintenance is enabled.",
      );
    }
    const rawLimit = process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_LIMIT;
    if (rawLimit !== undefined) {
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error(
          "[CONFIG] SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_LIMIT must be an integer from 1 to 1000.",
        );
      }
    }
  }

  if (process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_JOB=true.",
      );
    }
    const rawLimit = process.env.SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_LIMIT;
    if (rawLimit !== undefined) {
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error(
          "[CONFIG] SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_LIMIT must be an integer from 1 to 1000.",
        );
      }
    }
  }

  if (process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB=true.",
      );
    }
    const rawRetentionDays = process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_DAYS;
    if (rawRetentionDays !== undefined) {
      const retentionDays = Number(rawRetentionDays);
      if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 365) {
        throw new Error(
          "[CONFIG] SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_DAYS must be an integer from 7 to 365.",
        );
      }
    }
    const rawLimit = process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_LIMIT;
    if (rawLimit !== undefined) {
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error(
          "[CONFIG] SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_LIMIT must be an integer from 1 to 1000.",
        );
      }
    }
  }

  if (process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB=true.",
      );
    }
    if (!process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL?.trim()) {
      throw new Error(
        "[CONFIG] DISPUTE_SIMILARITY_REVIEW_ALERT_URL is required when similarity review alerting is enabled.",
      );
    }
    try {
      resolveDisputeSimilarityReviewAlertConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid dispute similarity review alert configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (
      isProduction &&
      (process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_ALLOW_INSECURE_HTTP === "true" ||
        process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_ALLOW_PRIVATE_NETWORK === "true")
    ) {
      throw new Error(
        "[CONFIG] Dispute similarity review alert network safety overrides are forbidden in production.",
      );
    }
  }

  if (
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB === "true" &&
    process.env.ENABLE_CRON !== "true"
  ) {
    throw new Error(
      "[CONFIG] ENABLE_CRON=true is required when ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB=true.",
    );
  }

  if (process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB=true.",
      );
    }
    if (!process.env.HAGGLE_AUDIT_ARCHIVE_URL?.trim()) {
      throw new Error(
        "[CONFIG] HAGGLE_AUDIT_ARCHIVE_URL is required when similarity review audit archiving is enabled.",
      );
    }
    if (!process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64?.trim()) {
      throw new Error(
        "[CONFIG] DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 is required when similarity review audit archiving is enabled.",
      );
    }
    try {
      resolveShipmentApvCancellationAuditArchiveConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid similarity review audit archive configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  if (process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB=true.",
      );
    }
    if (!process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL?.trim()) {
      throw new Error(
        "[CONFIG] DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL is required when similarity review audit archive alerting is enabled.",
      );
    }
    try {
      resolveDisputeSimilarityReviewAuditArchiveAlertConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid similarity review audit archive alert configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (
      isProduction &&
      (process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP === "true" ||
        process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK === "true")
    ) {
      throw new Error(
        "[CONFIG] Similarity review audit archive alert network safety overrides are forbidden in production.",
      );
    }
  }

  if (process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true")
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB=true.",
      );
    if (!process.env.HAGGLE_AUDIT_ARCHIVE_URL?.trim())
      throw new Error(
        "[CONFIG] HAGGLE_AUDIT_ARCHIVE_URL is required when dispute AI audit archiving is enabled.",
      );
    if (!process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64?.trim())
      throw new Error(
        "[CONFIG] DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 is required when dispute AI audit archiving is enabled.",
      );
    try {
      resolveShipmentApvCancellationAuditArchiveConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid dispute AI audit archive configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  if (process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true")
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB=true.",
      );
    if (!process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_URL?.trim())
      throw new Error(
        "[CONFIG] DISPUTE_AI_AUDIT_ARCHIVE_ALERT_URL is required when dispute AI audit archive alerting is enabled.",
      );
    try {
      resolveDisputeAiAuditArchiveAlertConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid dispute AI audit archive alert configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (
      isProduction &&
      (process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP === "true" ||
        process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK === "true")
    )
      throw new Error(
        "[CONFIG] Dispute AI audit archive alert network safety overrides are forbidden in production.",
      );
  }

  if (process.env.ENABLE_DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_JOB=true.",
      );
    }
    if (!process.env.HAGGLE_AUDIT_ARCHIVE_URL?.trim()) {
      throw new Error(
        "[CONFIG] HAGGLE_AUDIT_ARCHIVE_URL is required when evidence provenance archiving is enabled.",
      );
    }
    try {
      resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid evidence provenance archive configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  if (process.env.ENABLE_DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_ALERT_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_ALERT_JOB=true.",
      );
    }
    if (!process.env.DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_ALERT_URL?.trim()) {
      throw new Error(
        "[CONFIG] DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_ALERT_URL is required when evidence provenance archive alerting is enabled.",
      );
    }
    try {
      resolveDisputeEvidenceProvenanceArchiveAlertConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid evidence provenance archive alert configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (
      isProduction &&
      (process.env.DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP === "true" ||
        process.env.DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK === "true")
    )
      throw new Error(
        "[CONFIG] Evidence provenance archive alert network safety overrides are forbidden in production.",
      );
  }

  if (process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB=true.",
      );
    }
    if (!process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL?.trim()) {
      throw new Error(
        "[CONFIG] CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL is required when conditional settlement preflight alerting is enabled.",
      );
    }
    try {
      resolveConditionalSettlementPreflightAlertConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid conditional settlement preflight alert configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (
      isProduction &&
      (process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_INSECURE_HTTP === "true" ||
        process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_PRIVATE_NETWORK === "true")
    )
      throw new Error(
        "[CONFIG] Conditional settlement preflight alert network safety overrides are forbidden in production.",
      );
  }

  if (process.env.ENABLE_CONDITIONAL_SETTLEMENT_FINALITY_ALERT_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true")
      throw new Error("[CONFIG] ENABLE_CRON=true is required when finality alerting is enabled.");
    if (!process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_URL?.trim()) {
      throw new Error(
        "[CONFIG] CONDITIONAL_SETTLEMENT_FINALITY_ALERT_URL is required when finality alerting is enabled.",
      );
    }
    try {
      resolveConditionalSettlementFinalityAlertConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid conditional settlement finality alert configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (
      isProduction &&
      (process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_ALLOW_INSECURE_HTTP === "true" ||
        process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_ALLOW_PRIVATE_NETWORK === "true")
    ) {
      throw new Error(
        "[CONFIG] Conditional settlement finality alert network safety overrides are forbidden in production.",
      );
    }
  }

  if (process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true") {
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB=true.",
      );
    }
    if (!process.env.HAGGLE_AUDIT_ARCHIVE_URL?.trim()) {
      throw new Error(
        "[CONFIG] HAGGLE_AUDIT_ARCHIVE_URL is required when APV cancellation audit archiving is enabled.",
      );
    }
    try {
      resolveShipmentApvCancellationAuditArchiveConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid APV cancellation audit archive configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (
      isProduction &&
      (process.env.HAGGLE_AUDIT_ARCHIVE_ALLOW_INSECURE_HTTP === "true" ||
        process.env.HAGGLE_AUDIT_ARCHIVE_ALLOW_PRIVATE_NETWORK === "true")
    ) {
      throw new Error(
        "[CONFIG] Audit archive network safety overrides are forbidden in production.",
      );
    }
  }

  if (process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB === "true") {
    if (process.env.ENABLE_CRON !== "true")
      throw new Error(
        "[CONFIG] ENABLE_CRON=true is required when ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB=true.",
      );
    if (!process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL?.trim())
      throw new Error(
        "[CONFIG] HAGGLE_AUDIT_ARCHIVE_ALERT_URL is required when audit archive alerting is enabled.",
      );
    try {
      resolveShipmentApvCancellationAuditArchiveAlertConfigFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid audit archive alert configuration: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (
      isProduction &&
      (process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP === "true" ||
        process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK === "true")
    ) {
      throw new Error(
        "[CONFIG] Audit archive alert network safety overrides are forbidden in production.",
      );
    }
  }

  if (
    process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64?.trim() ||
    process.env.DISPUTE_AUDIT_TRUSTED_PUBLIC_KEYS_JSON?.trim()
  ) {
    try {
      resolveDisputeAuditPublicKeyRegistryFromEnv();
    } catch (error) {
      throw new Error(
        `[CONFIG] Invalid dispute audit public key registry: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  if (isProduction) {
    const hnpRequireSignature = process.env.HNP_REQUIRE_SIGNATURE?.trim().toLowerCase();
    const trustedJwks = process.env.HNP_TRUSTED_JWKS?.trim();
    if (hnpRequireSignature === "true" && !trustedJwks) {
      throw new Error("[CONFIG] HNP_TRUSTED_JWKS is required when HNP_REQUIRE_SIGNATURE=true.");
    }
    if (hnpRequireSignature !== "false" && trustedJwks) {
      const validation = validateTrustedHnpJwks(trustedJwks);
      if (!validation.ok) {
        throw new Error(
          `[CONFIG] HNP_TRUSTED_JWKS must be a valid JWKS with at least one supported public key: ${validation.reason}`,
        );
      }
    }
  }

  return {
    databaseUrl,
    isProduction,
    haggleEnv,
    publicAppUrl,
    corsAllowedOrigins: parseCorsOrigins(process.env.HAGGLE_CORS_ORIGINS),
  };
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  config: Pick<RuntimeConfig, "isProduction" | "corsAllowedOrigins">,
): boolean {
  if (!origin) return true;

  if (origin === "null") {
    return !config.isProduction;
  }

  let normalizedOrigin: string;
  let hostname: string;
  let protocol: string;
  try {
    const parsed = new URL(origin);
    normalizedOrigin = parsed.origin;
    hostname = parsed.hostname;
    protocol = parsed.protocol;
  } catch {
    return false;
  }

  if (config.corsAllowedOrigins.has(normalizedOrigin)) return true;

  if (!config.isProduction && (protocol === "http:" || protocol === "https:")) {
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    const isPrivateIpv4 =
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname);
    if (isLocalhost || isPrivateIpv4) return true;
  }

  return false;
}
