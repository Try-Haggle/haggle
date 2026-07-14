import { createHash, timingSafeEqual } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";
import { claimWebhookEvent, type WebhookEventClaim } from "./webhook-event-claim.service.js";

const DELIVERY_ID_RE = /^(?:health|recovery)_[0-9a-f]{64}$/;
const BODY_KEYS = new Set(["type", "delivery_id", "state", "created_at", "severity", "reasons", "health"]);
const HEALTH_KEYS = new Set(["status", "total", "pending", "unavailable", "orphanedReceipts", "rpcUnavailable",
  "configurationBlocked", "overduePending", "oldestPendingAgeSeconds", "pendingSlaSeconds", "recordedAt"]);
const FIRING_REASONS = new Set(["orphaned_receipt", "rpc_unavailable", "configuration_blocked", "confirmation_sla_overdue"]);
export const CONDITIONAL_SETTLEMENT_FINALITY_ALERT_RECEIVER_SOURCE = "haggle-conditional-settlement-finality-alert-receiver";
export const CONDITIONAL_SETTLEMENT_FINALITY_ALERT_MAX_RECEIVER_SECRETS = 4;
const MIN_SECRET_LENGTH = 16;
const MAX_SECRET_LENGTH = 128;

export function resolveConditionalSettlementFinalityAlertReceiverSecretsFromEnv() {
  const current = process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET?.trim() ?? "";
  const previousRaw = process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS?.trim() ?? "";
  const previous = previousRaw ? previousRaw.split(",").map((item) => item.trim()) : [];
  if (!current && previous.length) throw new Error("finality alert current secret is required when previous secrets are configured");
  const secrets = current ? [current, ...previous] : [];
  if (secrets.some((item) => item.length < MIN_SECRET_LENGTH || item.length > MAX_SECRET_LENGTH)) {
    throw new Error(`finality alert receiver secrets must be ${MIN_SECRET_LENGTH}..${MAX_SECRET_LENGTH} characters`);
  }
  if (new Set(secrets).size !== secrets.length) throw new Error("finality alert receiver secrets must be unique");
  if (secrets.length > CONDITIONAL_SETTLEMENT_FINALITY_ALERT_MAX_RECEIVER_SECRETS) {
    throw new Error(`finality alert receiver accepts at most ${CONDITIONAL_SETTLEMENT_FINALITY_ALERT_MAX_RECEIVER_SECRETS} secrets`);
  }
  return secrets;
}

export function getConditionalSettlementFinalityAlertReceiverPolicyStatus() {
  try {
    const secrets = resolveConditionalSettlementFinalityAlertReceiverSecretsFromEnv();
    return { configured: secrets.length > 0, configurationState: secrets.length ? "valid" as const : "not_configured" as const,
      acceptedSecretCount: secrets.length, maxAcceptedSecretCount: CONDITIONAL_SETTLEMENT_FINALITY_ALERT_MAX_RECEIVER_SECRETS,
      timestampToleranceSeconds: 300 };
  } catch {
    return { configured: false, configurationState: "invalid" as const, acceptedSecretCount: 0,
      maxAcceptedSecretCount: CONDITIONAL_SETTLEMENT_FINALITY_ALERT_MAX_RECEIVER_SECRETS, timestampToleranceSeconds: 300 };
  }
}

export async function getConditionalSettlementFinalityAlertReceiverHealth(db: Database,
  source = CONDITIONAL_SETTLEMENT_FINALITY_ALERT_RECEIVER_SOURCE) {
  const rows = await db.execute(sql`SELECT count(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
    count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed, count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
    count(*) FILTER (WHERE status = 'PROCESSING' AND lease_expires_at <= now())::int AS stale_processing,
    count(*) FILTER (WHERE status = 'FAILED' AND (next_attempt_at IS NULL OR next_attempt_at <= now()))::int AS retry_ready,
    coalesce(max(attempt_count), 0)::int AS max_attempt_count,
    extract(epoch FROM now() - min(created_at) FILTER (WHERE status != 'COMPLETED')) AS oldest_unfinished_age_seconds,
    max(completed_at) FILTER (WHERE status = 'COMPLETED') AS last_completed_at
    FROM webhook_idempotency WHERE source = ${source}`) as unknown as Array<Record<string, string | number | Date | null>>;
  const row = rows[0] ?? {}; const failed = Number(row.failed ?? 0); const staleProcessing = Number(row.stale_processing ?? 0);
  return { status: staleProcessing > 0 ? "critical" as const : failed > 0 ? "warning" as const : "healthy" as const,
    processing: Number(row.processing ?? 0), completed: Number(row.completed ?? 0), failed, staleProcessing,
    retryReady: Number(row.retry_ready ?? 0), maxAttemptCount: Number(row.max_attempt_count ?? 0),
    oldestUnfinishedAgeSeconds: row.oldest_unfinished_age_seconds === null || row.oldest_unfinished_age_seconds === undefined
      ? null : Math.max(0, Math.round(Number(row.oldest_unfinished_age_seconds))),
    lastCompletedAt: row.last_completed_at ? new Date(row.last_completed_at).toISOString() : null,
    recordedAt: new Date().toISOString() };
}

type Verification =
  | { ok: true; deliveryId: string; payloadSha256: string; state: "firing" | "recovered"; severity: "warning" | "critical" | "recovery" }
  | { ok: false; error: "MISSING_ALERT_AUTH" | "INVALID_DELIVERY_ID" | "INVALID_ALERT_TIMESTAMP" | "ALERT_TIMESTAMP_OUT_OF_RANGE"
      | "INVALID_ALERT_BODY" | "ALERT_DELIVERY_ID_MISMATCH" | "INVALID_ALERT_SIGNATURE" };
function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function nonnegativeInteger(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }

function validHealth(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const health = value as Record<string, unknown>;
  if (Object.keys(health).some((key) => !HEALTH_KEYS.has(key))) return false;
  if (!(["healthy", "attention", "critical"] as unknown[]).includes(health.status)) return false;
  for (const key of ["total", "pending", "unavailable", "orphanedReceipts", "rpcUnavailable", "configurationBlocked", "overduePending", "pendingSlaSeconds"]) {
    if (!nonnegativeInteger(health[key])) return false;
  }
  if (health.oldestPendingAgeSeconds !== null && !nonnegativeInteger(health.oldestPendingAgeSeconds)) return false;
  return (health.pendingSlaSeconds as number) > 0
    && health.total === (health.pending as number) + (health.unavailable as number)
    && (health.oldestPendingAgeSeconds === null) === (health.pending === 0)
    && typeof health.recordedAt === "string" && Number.isFinite(Date.parse(health.recordedAt));
}

function reasonsMatchHealth(reasons: string[], health: Record<string, unknown>) {
  return reasons.includes("orphaned_receipt") === ((health.orphanedReceipts as number) > 0)
    && reasons.includes("rpc_unavailable") === ((health.rpcUnavailable as number) > 0)
    && reasons.includes("configuration_blocked") === ((health.configurationBlocked as number) > 0)
    && reasons.includes("confirmation_sla_overdue") === ((health.overduePending as number) > 0);
}

export function verifyConditionalSettlementFinalityAlert(input: { rawBody: Buffer | string; timestamp?: string | string[];
  signature?: string | string[]; deliveryId?: string | string[]; secret: string | string[]; nowMs?: number; toleranceMs?: number }): Verification {
  const timestamp = single(input.timestamp); const signature = single(input.signature); const deliveryId = single(input.deliveryId);
  if (!timestamp || !signature || !deliveryId) return { ok: false, error: "MISSING_ALERT_AUTH" };
  if (!DELIVERY_ID_RE.test(deliveryId)) return { ok: false, error: "INVALID_DELIVERY_ID" };
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return { ok: false, error: "INVALID_ALERT_TIMESTAMP" };
  if (Math.abs((input.nowMs ?? Date.now()) - timestampMs) > (input.toleranceMs ?? 300_000)) return { ok: false, error: "ALERT_TIMESTAMP_OUT_OF_RANGE" };
  const raw = Buffer.isBuffer(input.rawBody) ? input.rawBody.toString("utf8") : input.rawBody;
  let body: Record<string, unknown>; try { body = JSON.parse(raw); } catch { return { ok: false, error: "INVALID_ALERT_BODY" }; }
  if (Object.keys(body).some((key) => !BODY_KEYS.has(key)) || body.type !== "conditional_settlement_finality.health"
    || body.delivery_id !== deliveryId || body.created_at !== timestamp || !validHealth(body.health) || !Array.isArray(body.reasons)
    || body.reasons.some((reason) => typeof reason !== "string")) {
    return { ok: false, error: body.delivery_id !== deliveryId ? "ALERT_DELIVERY_ID_MISMATCH" : "INVALID_ALERT_BODY" };
  }
  const state = body.state; const severity = body.severity; const reasons = body.reasons as string[];
  const health = body.health as Record<string, unknown>;
  const validRecovery = state === "recovered" && severity === "recovery"
    && reasons.length === 1 && reasons[0] === "conditional_settlement_finality_recovered"
    && health.status === "healthy" && health.orphanedReceipts === 0 && health.rpcUnavailable === 0
    && health.configurationBlocked === 0 && health.overduePending === 0;
  const validFiring = state === "firing" && (severity === "warning" || severity === "critical") && reasons.length > 0
    && reasons.every((reason) => FIRING_REASONS.has(reason))
    && (severity === "critical") === reasons.includes("orphaned_receipt")
    && health.status === (severity === "critical" ? "critical" : "attention")
    && reasonsMatchHealth(reasons, health);
  if (!validRecovery && !validFiring) return { ok: false, error: "INVALID_ALERT_BODY" };
  const received = Buffer.from(signature.startsWith("sha256=") ? signature : `sha256=${signature}`);
  const verificationSecrets = Array.isArray(input.secret) ? input.secret : [input.secret];
  if (!verificationSecrets.length || verificationSecrets.length > CONDITIONAL_SETTLEMENT_FINALITY_ALERT_MAX_RECEIVER_SECRETS
    || verificationSecrets.some((item) => item.length < MIN_SECRET_LENGTH || item.length > MAX_SECRET_LENGTH)) {
    return { ok: false, error: "INVALID_ALERT_SIGNATURE" };
  }
  let matched = false;
  for (const secret of verificationSecrets) {
    const expected = Buffer.from(signWebhookClaimAlertPayload(secret, timestamp, raw));
    matched = (received.length === expected.length && timingSafeEqual(received, expected)) || matched;
  }
  if (!matched) return { ok: false, error: "INVALID_ALERT_SIGNATURE" };
  return { ok: true, deliveryId, payloadSha256: createHash("sha256").update(input.rawBody).digest("hex"),
    state: state as "firing" | "recovered", severity: severity as "warning" | "critical" | "recovery" };
}

export async function claimVerifiedConditionalSettlementFinalityAlert(db: Database, verification: Extract<Verification, { ok: true }>,
  source = CONDITIONAL_SETTLEMENT_FINALITY_ALERT_RECEIVER_SOURCE): Promise<{ outcome: "accepted"; claim: WebhookEventClaim }
    | { outcome: "replay_completed" } | { outcome: "in_progress" } | { outcome: "retry_backoff"; retryAfterSeconds: number }
    | { outcome: "payload_conflict" }> {
  const claim = await claimWebhookEvent(db, { source, eventId: verification.deliveryId, payloadSha256: verification.payloadSha256 });
  if (claim.outcome === "acquired") return { outcome: "accepted", claim };
  if (claim.outcome === "payload_conflict") return { outcome: "payload_conflict" };
  if (claim.outcome === "duplicate") return { outcome: "replay_completed" };
  if (claim.outcome === "in_progress") return { outcome: "in_progress" };
  return { outcome: "retry_backoff", retryAfterSeconds: claim.retryAfterSeconds ?? 1 };
}
