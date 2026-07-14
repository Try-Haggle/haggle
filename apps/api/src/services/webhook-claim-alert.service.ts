import { createHash, createHmac } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import type { WebhookClaimHealth } from "./webhook-event-claim.service.js";
import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";

export interface WebhookClaimAlertConfig {
  url: string;
  secret: string;
  timeoutMs: number;
  cooldownMinutes: number;
  failedThreshold: number;
  staleThreshold: number;
  retryReadyThreshold: number;
  allowInsecureHttp: boolean;
  allowPrivateNetwork: boolean;
}

export interface WebhookClaimAlertAssessment {
  wouldAlert: boolean;
  severity: "warning" | "critical" | "recovery" | null;
  reasons: string[];
}

export const WEBHOOK_CLAIM_ALERT_SOURCE = "haggle-webhook-claim-alert";

export interface WebhookClaimAlertPolicyStatus {
  configured: boolean;
  jobEnabled: boolean;
  cooldownMinutes: number;
  failedThreshold: number;
  staleThreshold: number;
  retryReadyThreshold: number;
}

export interface WebhookClaimAlertResult {
  status: "delivered" | "failed";
  httpStatus?: number;
  error?: string;
}

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export function getWebhookClaimAlertPolicyStatus(): WebhookClaimAlertPolicyStatus {
  return {
    configured: Boolean(
      process.env.WEBHOOK_CLAIM_ALERT_URL
      && (process.env.WEBHOOK_CLAIM_ALERT_SECRET?.length ?? 0) >= 16
    ),
    jobEnabled: process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB === "true",
    cooldownMinutes: boundedInteger(process.env.WEBHOOK_CLAIM_ALERT_COOLDOWN_MINUTES, 15, 1, 1440),
    failedThreshold: boundedInteger(process.env.WEBHOOK_CLAIM_ALERT_FAILED_THRESHOLD, 1, 1, 100_000),
    staleThreshold: boundedInteger(process.env.WEBHOOK_CLAIM_ALERT_STALE_THRESHOLD, 1, 1, 100_000),
    retryReadyThreshold: boundedInteger(process.env.WEBHOOK_CLAIM_ALERT_RETRY_READY_THRESHOLD, 1, 1, 100_000),
  };
}

export function resolveWebhookClaimAlertConfigFromEnv(): WebhookClaimAlertConfig | null {
  const url = process.env.WEBHOOK_CLAIM_ALERT_URL;
  if (!url) return null;
  const secret = process.env.WEBHOOK_CLAIM_ALERT_SECRET ?? "";
  if (secret.length < 16) throw new Error("webhook claim alert secret must be at least 16 characters");
  const policy = getWebhookClaimAlertPolicyStatus();
  const config = {
    url,
    secret,
    timeoutMs: boundedInteger(process.env.WEBHOOK_CLAIM_ALERT_TIMEOUT_MS, 5000, 250, 30_000),
    cooldownMinutes: policy.cooldownMinutes,
    failedThreshold: policy.failedThreshold,
    staleThreshold: policy.staleThreshold,
    retryReadyThreshold: policy.retryReadyThreshold,
    allowInsecureHttp: process.env.WEBHOOK_CLAIM_ALERT_ALLOW_INSECURE_HTTP === "true",
    allowPrivateNetwork: process.env.WEBHOOK_CLAIM_ALERT_ALLOW_PRIVATE_NETWORK === "true",
  };
  assertDisputeModuleOutboundUrl(config.url, {
    label: "webhook claim alert",
    allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  return config;
}

export function evaluateWebhookClaimAlert(
  health: WebhookClaimHealth,
  thresholds: Pick<WebhookClaimAlertConfig, "failedThreshold" | "staleThreshold" | "retryReadyThreshold">,
): WebhookClaimAlertAssessment {
  const reasons: string[] = [];
  if (health.totals.staleProcessing >= thresholds.staleThreshold) reasons.push("stale_processing");
  if (health.totals.failed >= thresholds.failedThreshold) reasons.push("failed");
  if (health.totals.retryReady >= thresholds.retryReadyThreshold) reasons.push("retry_ready");
  return {
    wouldAlert: reasons.length > 0,
    severity: reasons.includes("stale_processing") ? "critical" : reasons.length ? "warning" : null,
    reasons,
  };
}

export function buildWebhookClaimAlertPayload(
  health: WebhookClaimHealth,
  assessment: WebhookClaimAlertAssessment,
  now = new Date(),
) {
  return {
    type: "webhook_claim.health" as const,
    state: assessment.severity === "recovery" ? "recovered" as const : "firing" as const,
    created_at: now.toISOString(),
    severity: assessment.severity,
    reasons: assessment.reasons,
    totals: health.totals,
    sources: health.sources.map((source) => ({
      source: source.source,
      processing: source.processing,
      failed: source.failed,
      stale_processing: source.staleProcessing,
      retry_ready: source.retryReady,
      max_attempt_count: source.maxAttemptCount,
      oldest_unfinished_age_seconds: source.oldestUnfinishedAgeSeconds,
    })),
  };
}

export async function getWebhookClaimAlertDeliveryState(db: Database, source = WEBHOOK_CLAIM_ALERT_SOURCE) {
  const rows = await db.execute(sql`SELECT
    max(completed_at) FILTER (WHERE left(idempotency_key, 7) = 'health_') AS last_incident_at,
    max(completed_at) FILTER (WHERE left(idempotency_key, 9) = 'recovery_') AS last_recovery_at
    FROM webhook_idempotency WHERE source = ${source} AND status = 'COMPLETED'`) as unknown as Array<Record<string, Date | string | null>>;
  const incident = rows[0]?.last_incident_at ? new Date(rows[0].last_incident_at) : null;
  const recovery = rows[0]?.last_recovery_at ? new Date(rows[0].last_recovery_at) : null;
  return { incidentOpen: Boolean(incident && (!recovery || recovery < incident)),
    lastIncidentAlertAt: incident?.toISOString() ?? null, lastRecoveryAlertAt: recovery?.toISOString() ?? null };
}

export async function findLatestDeliveredWebhookClaimIncident(db: Database, source = WEBHOOK_CLAIM_ALERT_SOURCE) {
  const rows = await db.execute(sql`SELECT idempotency_key AS event_id, completed_at FROM webhook_idempotency
    WHERE source = ${source} AND status = 'COMPLETED' AND left(idempotency_key, 7) = 'health_'
    ORDER BY completed_at DESC, id DESC LIMIT 1`) as unknown as Array<{ event_id: string; completed_at: Date | string }>;
  return rows[0] ? { eventId: rows[0].event_id, completedAt: new Date(rows[0].completed_at).toISOString() } : null;
}

export function signWebhookClaimAlertPayload(secret: string, timestamp: string, rawBody: string): string {
  if (secret.length < 16) throw new Error("webhook claim alert secret must be at least 16 characters");
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${bodyHash}`).digest("hex")}`;
}

export async function sendWebhookClaimAlert(
  health: WebhookClaimHealth,
  assessment: WebhookClaimAlertAssessment,
  options: { config: WebhookClaimAlertConfig; deliveryId?: string; fetchImpl?: typeof fetch; now?: Date },
): Promise<WebhookClaimAlertResult> {
  assertDisputeModuleOutboundUrl(options.config.url, {
    label: "webhook claim alert",
    allowInsecureHttp: options.config.allowInsecureHttp,
    allowPrivateNetwork: options.config.allowPrivateNetwork,
  });
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();
  if (options.deliveryId && !/^(?:health|recovery)_[0-9a-f]{64}$/.test(options.deliveryId)) throw new Error("invalid webhook claim alert delivery id");
  const rawBody = JSON.stringify({ ...buildWebhookClaimAlertPayload(health, assessment, now),
    ...(options.deliveryId ? { delivery_id: options.deliveryId } : {}) });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.config.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(options.config.url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-haggle-alert-type": "webhook_claim.health",
        "x-haggle-alert-timestamp": timestamp,
        ...(options.deliveryId ? { "x-haggle-alert-delivery-id": options.deliveryId } : {}),
        "x-haggle-alert-signature": signWebhookClaimAlertPayload(options.config.secret, timestamp, rawBody),
      },
      body: rawBody,
    });
    return { status: response.ok ? "delivered" : "failed", httpStatus: response.status };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}
