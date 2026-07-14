import { sql, type Database } from "@haggle/db";
import type { DisputeSimilarityReviewAuditArchiveHealth } from "./dispute-similarity-review-audit-archive.service.js";
import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";

export interface DisputeSimilarityReviewAuditArchiveAlertConfig {
  url: string;
  secret: string;
  timeoutMs: number;
  cooldownMinutes: number;
  staleThreshold: number;
  retryReadyThreshold: number;
  deadLetterThreshold: number;
  overdueUnfinishedThreshold: number;
  allowInsecureHttp: boolean;
  allowPrivateNetwork: boolean;
}

export const DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SOURCE = "haggle-dispute-similarity-review-audit-archive-alert";

export interface DisputeSimilarityReviewAuditArchiveAlertAssessment {
  wouldAlert: boolean;
  severity: "critical" | "warning" | "recovery" | null;
  reasons: string[];
}

export async function getDisputeSimilarityReviewAuditArchiveAlertDeliveryState(
  db: Database,
  source = DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SOURCE,
) {
  const rows = await db.execute(sql`
    SELECT max(completed_at) FILTER (WHERE left(idempotency_key, 7) = 'health_') AS last_incident_at,
           max(completed_at) FILTER (WHERE left(idempotency_key, 9) = 'recovery_') AS last_recovery_at
      FROM webhook_idempotency
     WHERE source = ${source}
       AND status = 'COMPLETED'
  `) as unknown as Array<{ last_incident_at: Date | string | null; last_recovery_at: Date | string | null }>;
  const incident = rows[0]?.last_incident_at ? new Date(rows[0].last_incident_at) : null;
  const recovery = rows[0]?.last_recovery_at ? new Date(rows[0].last_recovery_at) : null;
  return {
    incidentOpen: Boolean(incident && (!recovery || recovery < incident)),
    lastIncidentAlertAt: incident?.toISOString() ?? null,
    lastRecoveryAlertAt: recovery?.toISOString() ?? null,
  };
}

export async function findLatestDeliveredDisputeSimilarityReviewAuditArchiveIncident(
  db: Database,
  source = DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SOURCE,
) {
  const rows = await db.execute(sql`
    SELECT idempotency_key AS event_id, completed_at
      FROM webhook_idempotency
     WHERE source = ${source}
       AND status = 'COMPLETED' AND left(idempotency_key, 7) = 'health_'
     ORDER BY completed_at DESC, id DESC
     LIMIT 1
  `) as unknown as Array<{ event_id: string; completed_at: Date | string }>;
  const row = rows[0];
  return row ? { eventId: row.event_id, completedAt: new Date(row.completed_at).toISOString() } : null;
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function getDisputeSimilarityReviewAuditArchiveAlertPolicyStatus() {
  const url = process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL?.trim();
  const secret = process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET ?? "";
  let configurationState: "not_configured" | "partial" | "valid" | "invalid" = !url && !secret
    ? "not_configured" : !url || secret.length < 16 ? "partial" : "valid";
  if (configurationState === "valid" && url) {
    try {
      assertDisputeModuleOutboundUrl(url, {
        label: "similarity review audit archive alert",
        allowInsecureHttp: process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP === "true",
        allowPrivateNetwork: process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK === "true",
      });
    } catch { configurationState = "invalid"; }
  }
  return {
    configured: configurationState === "valid",
    configurationState,
    jobEnabled: process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB === "true",
    cooldownMinutes: boundedInteger(process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_COOLDOWN_MINUTES, 15, 1, 1440),
    staleThreshold: boundedInteger(process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_STALE_THRESHOLD, 1, 1, 100_000),
    retryReadyThreshold: boundedInteger(process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_RETRY_READY_THRESHOLD, 5, 1, 100_000),
    deadLetterThreshold: boundedInteger(process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_DEAD_LETTER_THRESHOLD, 1, 1, 100_000),
    overdueUnfinishedThreshold: boundedInteger(process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_OVERDUE_UNFINISHED_THRESHOLD, 1, 1, 100_000),
  };
}

export function resolveDisputeSimilarityReviewAuditArchiveAlertConfigFromEnv(): DisputeSimilarityReviewAuditArchiveAlertConfig | null {
  const url = process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL?.trim();
  if (!url) return null;
  const secret = process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET ?? "";
  if (secret.length < 16) throw new Error("similarity review audit archive alert secret must be at least 16 characters");
  const policy = getDisputeSimilarityReviewAuditArchiveAlertPolicyStatus();
  const config = {
    url,
    secret,
    timeoutMs: boundedInteger(process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_TIMEOUT_MS, 5000, 250, 30_000),
    cooldownMinutes: policy.cooldownMinutes,
    staleThreshold: policy.staleThreshold,
    retryReadyThreshold: policy.retryReadyThreshold,
    deadLetterThreshold: policy.deadLetterThreshold,
    overdueUnfinishedThreshold: policy.overdueUnfinishedThreshold,
    allowInsecureHttp: process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP === "true",
    allowPrivateNetwork: process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK === "true",
  };
  assertDisputeModuleOutboundUrl(config.url, {
    label: "similarity review audit archive alert",
    allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  return config;
}

export function evaluateDisputeSimilarityReviewAuditArchiveAlert(
  health: DisputeSimilarityReviewAuditArchiveHealth,
  policy: Pick<DisputeSimilarityReviewAuditArchiveAlertConfig, "staleThreshold" | "retryReadyThreshold" | "deadLetterThreshold" | "overdueUnfinishedThreshold">,
) {
  const reasons = [
    ...(health.deadLetter >= policy.deadLetterThreshold ? ["similarity_audit_archive_dead_letter"] : []),
    ...(health.staleProcessing >= policy.staleThreshold ? ["similarity_audit_archive_stale_processing"] : []),
    ...(health.retryReady >= policy.retryReadyThreshold ? ["similarity_audit_archive_retry_ready_backlog"] : []),
    ...(health.overdueUnfinished >= policy.overdueUnfinishedThreshold ? ["similarity_audit_archive_unfinished_too_old"] : []),
  ];
  return {
    wouldAlert: reasons.length > 0,
    severity: reasons.includes("similarity_audit_archive_dead_letter") ? "critical" as const : reasons.length ? "warning" as const : null,
    reasons,
  };
}

export async function sendDisputeSimilarityReviewAuditArchiveAlert(
  health: DisputeSimilarityReviewAuditArchiveHealth,
  assessment: DisputeSimilarityReviewAuditArchiveAlertAssessment,
  options: { config: DisputeSimilarityReviewAuditArchiveAlertConfig; deliveryId: string; fetchImpl?: typeof fetch; now?: Date },
) {
  if (!/^(?:health|recovery)_[0-9a-f]{64}$/.test(options.deliveryId)) {
    throw new Error("invalid similarity review audit archive alert delivery id");
  }
  assertDisputeModuleOutboundUrl(options.config.url, {
    label: "similarity review audit archive alert",
    allowInsecureHttp: options.config.allowInsecureHttp,
    allowPrivateNetwork: options.config.allowPrivateNetwork,
  });
  const timestamp = (options.now ?? new Date()).toISOString();
  const rawBody = JSON.stringify({
    type: "dispute_similarity_review_audit_archive.health",
    delivery_id: options.deliveryId,
    state: assessment.severity === "recovery" ? "recovered" : "firing",
    created_at: timestamp,
    severity: assessment.severity,
    reasons: assessment.reasons,
    health,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.config.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(options.config.url, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-haggle-alert-type": "dispute_similarity_review_audit_archive.health",
        "x-haggle-alert-delivery-id": options.deliveryId,
        "x-haggle-alert-timestamp": timestamp,
        "x-haggle-alert-signature": signWebhookClaimAlertPayload(options.config.secret, timestamp, rawBody),
      },
      body: rawBody,
    });
    return { status: response.ok ? "delivered" as const : "failed" as const, httpStatus: response.status };
  } catch (error) {
    return { status: "failed" as const, error: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timeout); }
}
