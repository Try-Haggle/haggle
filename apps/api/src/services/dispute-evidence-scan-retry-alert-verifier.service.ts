import { createHash, timingSafeEqual } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { signWebhookClaimAlertPayload } from
  "./webhook-claim-alert.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
} from "./webhook-event-claim.service.js";

const DELIVERY_ID_RE = /^(?:health|recovery)_[0-9a-f]{64}$/;
const BODY_KEYS = ["schema_version", "type", "delivery_id", "state",
  "created_at", "severity", "reasons", "thresholds", "health"];
const THRESHOLD_KEYS_V2 = ["retry_ready", "stale_processing", "exhausted",
  "expired_quarantined"];
const THRESHOLD_KEYS_V3 = [...THRESHOLD_KEYS_V2,
  "retention_blocked_expired"];
const HEALTH_KEYS_V2 = ["totals", "oldest_unresolved_age_seconds", "circuit"];
const HEALTH_KEYS_V3 = [...HEALTH_KEYS_V2, "retention"];
const CIRCUIT_KEYS = ["state", "consecutive_failures", "active_permits",
  "max_concurrent", "failure_threshold"];
const TOTAL_KEYS = ["quarantined", "pending", "failed", "processing",
  "stale_processing", "retry_ready", "exhausted", "expired_quarantined"];
const RETENTION_KEYS = ["eligible_expired", "blocked_expired",
  "oldest_blocked_expired_age_seconds", "job"];
const RETENTION_JOB_KEYS = ["active", "status", "last_run_status", "overdue",
  "lease_stale", "last_deleted_snapshots", "interval_seconds",
  "max_start_delay_seconds"];
const FIRING_REASONS = ["scanner_circuit_open", "scanner_circuit_half_open",
  "alert_snapshot_retention_job_stale", "alert_snapshot_retention_blocked",
  "scan_retry_exhausted",
  "scan_retry_expired_quarantine", "scan_retry_stale_processing",
  "scan_retry_ready_backlog", "alert_snapshot_retention_job_failed",
  "alert_snapshot_retention_job_overdue"];
export const DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_SOURCE =
  "haggle-dispute-evidence-scan-retry-alert-receiver";
export const DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_PATH =
  "/internal/ops/alerts/dispute-evidence-scan-retry";
export const DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_HEALTH_PATH =
  "/admin/ops/alerts/dispute-evidence-scan-retry/health";

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as object).sort().join("|")
      === [...keys].sort().join("|");
}

function boundedNonnegative(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= 0 && value <= 1_000_000_000;
}

function boundedPositive(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= 1 && value <= 100_000;
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function expectedReasons(
  totals: Record<string, unknown>,
  thresholds: Record<string, unknown>,
  circuit: Record<string, unknown>,
  retention?: Record<string, unknown>,
  retentionJob?: Record<string, unknown>,
) {
  const active = retentionJob?.active === true;
  return [
    ...(circuit.state === "OPEN" ? ["scanner_circuit_open"] : []),
    ...(circuit.state === "HALF_OPEN"
      ? ["scanner_circuit_half_open"] : []),
    ...(active && retentionJob?.last_run_status === "STALE_RUNNING"
      ? ["alert_snapshot_retention_job_stale"] : []),
    ...(retention && (retention.blocked_expired as number)
      >= (thresholds.retention_blocked_expired as number)
      ? ["alert_snapshot_retention_blocked"] : []),
    ...((totals.exhausted as number) >= (thresholds.exhausted as number)
      ? ["scan_retry_exhausted"] : []),
    ...((totals.expired_quarantined as number)
      >= (thresholds.expired_quarantined as number)
      ? ["scan_retry_expired_quarantine"] : []),
    ...((totals.stale_processing as number)
      >= (thresholds.stale_processing as number)
      ? ["scan_retry_stale_processing"] : []),
    ...((totals.retry_ready as number) >= (thresholds.retry_ready as number)
      ? ["scan_retry_ready_backlog"] : []),
    ...(active && retentionJob?.last_run_status === "FAILED"
      ? ["alert_snapshot_retention_job_failed"] : []),
    ...(active && retentionJob?.overdue === true
      ? ["alert_snapshot_retention_job_overdue"] : []),
  ];
}

export type DisputeEvidenceScanRetryAlertVerification =
  | {
    ok: true;
    deliveryId: string;
    state: "firing" | "recovered";
    severity: "warning" | "critical" | "recovery";
    payloadSha256: string;
  }
  | {
    ok: false;
    error: "MISSING_ALERT_AUTH" | "INVALID_DELIVERY_ID"
      | "INVALID_ALERT_TIMESTAMP" | "ALERT_TIMESTAMP_OUT_OF_RANGE"
      | "INVALID_ALERT_BODY" | "ALERT_DELIVERY_ID_MISMATCH"
      | "INVALID_ALERT_SIGNATURE";
  };

export function resolveDisputeEvidenceScanRetryAlertReceiverSecretsFromEnv() {
  const current =
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET?.trim() ?? "";
  const previousRaw =
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_PREVIOUS_SECRETS?.trim()
    ?? "";
  const previous = previousRaw
    ? previousRaw.split(",").map((value) => value.trim()) : [];
  if (!current && previous.length) {
    throw new Error("scan retry alert current secret is required");
  }
  const secrets = current ? [current, ...previous] : [];
  if (secrets.some((value) => value.length < 16 || value.length > 128)) {
    throw new Error("scan retry alert receiver secrets must be 16..128 characters");
  }
  if (new Set(secrets).size !== secrets.length || secrets.length > 4) {
    throw new Error("scan retry alert receiver secrets must be unique and at most 4");
  }
  return secrets;
}

export function getDisputeEvidenceScanRetryAlertReceiverPolicyStatus() {
  try {
    const secrets = resolveDisputeEvidenceScanRetryAlertReceiverSecretsFromEnv();
    return {
      configured: secrets.length > 0,
      configurationState: secrets.length ? "valid" as const
        : "not_configured" as const,
      acceptedSecretCount: secrets.length,
      maxAcceptedSecretCount: 4,
      timestampToleranceSeconds: 300,
    };
  } catch {
    return {
      configured: false,
      configurationState: "invalid" as const,
      acceptedSecretCount: 0,
      maxAcceptedSecretCount: 4,
      timestampToleranceSeconds: 300,
    };
  }
}

export async function getDisputeEvidenceScanRetryAlertReceiverHealth(
  db: Database,
  source = DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_SOURCE,
) {
  const rows = await db.execute(sql`
    SELECT count(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
           count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
           count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
           count(*) FILTER (
             WHERE status = 'PROCESSING' AND lease_expires_at <= now()
           )::int AS "staleProcessing",
           count(*) FILTER (
             WHERE status = 'FAILED'
               AND (next_attempt_at IS NULL OR next_attempt_at <= now())
           )::int AS "retryReady",
           coalesce(max(attempt_count), 0)::int AS "maxAttemptCount",
           extract(epoch FROM now() - min(created_at) FILTER (
             WHERE status != 'COMPLETED'
           ))::int AS "oldestUnfinishedAgeSeconds",
           max(completed_at) FILTER (
             WHERE status = 'COMPLETED'
           ) AS "lastCompletedAt"
      FROM webhook_idempotency
     WHERE source = ${source}
  `) as unknown as Array<Record<string, number | string | Date | null>>;
  const row = rows[0] ?? {};
  const failed = Number(row.failed ?? 0);
  const staleProcessing = Number(row.staleProcessing ?? 0);
  return {
    status: staleProcessing > 0 ? "critical" as const
      : failed > 0 ? "warning" as const : "healthy" as const,
    processing: Number(row.processing ?? 0),
    completed: Number(row.completed ?? 0),
    failed,
    staleProcessing,
    retryReady: Number(row.retryReady ?? 0),
    maxAttemptCount: Number(row.maxAttemptCount ?? 0),
    oldestUnfinishedAgeSeconds: row.oldestUnfinishedAgeSeconds === null
      || row.oldestUnfinishedAgeSeconds === undefined ? null
      : Math.max(0, Number(row.oldestUnfinishedAgeSeconds)),
    lastCompletedAt: row.lastCompletedAt
      ? new Date(row.lastCompletedAt).toISOString() : null,
    recordedAt: new Date().toISOString(),
    containsIdentifiers: false,
  };
}

export function verifyDisputeEvidenceScanRetryAlert(input: {
  rawBody: Buffer | string;
  timestamp?: string | string[];
  signature?: string | string[];
  deliveryId?: string | string[];
  secret: string | string[];
  nowMs?: number;
  toleranceMs?: number;
}): DisputeEvidenceScanRetryAlertVerification {
  const timestamp = single(input.timestamp);
  const signature = single(input.signature);
  const deliveryId = single(input.deliveryId);
  if (!timestamp || !signature || !deliveryId) {
    return { ok: false, error: "MISSING_ALERT_AUTH" };
  }
  if (!DELIVERY_ID_RE.test(deliveryId)) {
    return { ok: false, error: "INVALID_DELIVERY_ID" };
  }
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, error: "INVALID_ALERT_TIMESTAMP" };
  }
  if (Math.abs((input.nowMs ?? Date.now()) - timestampMs)
    > (input.toleranceMs ?? 300_000)) {
    return { ok: false, error: "ALERT_TIMESTAMP_OUT_OF_RANGE" };
  }
  const raw = Buffer.isBuffer(input.rawBody)
    ? input.rawBody.toString("utf8") : input.rawBody;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "INVALID_ALERT_BODY" };
  }
  const isV3 = body.schema_version
    === "dispute-evidence-scan-retry-alert-v3";
  const isV2 = body.schema_version
    === "dispute-evidence-scan-retry-alert-v2";
  if (!exact(body, BODY_KEYS) || (!isV2 && !isV3)
    || body.type !== "dispute_evidence_scan_retry.health") {
    return { ok: false, error: "INVALID_ALERT_BODY" };
  }
  if (body.delivery_id !== deliveryId) {
    return { ok: false, error: "ALERT_DELIVERY_ID_MISMATCH" };
  }
  const thresholds = body.thresholds;
  const alertHealth = body.health;
  const thresholdKeys = isV3 ? THRESHOLD_KEYS_V3 : THRESHOLD_KEYS_V2;
  const healthKeys = isV3 ? HEALTH_KEYS_V3 : HEALTH_KEYS_V2;
  if (!exact(thresholds, thresholdKeys)
    || !exact(alertHealth, healthKeys)) {
    return { ok: false, error: "INVALID_ALERT_BODY" };
  }
  const totals = alertHealth.totals;
  const circuit = alertHealth.circuit;
  const retention = isV3 ? alertHealth.retention : undefined;
  const retentionJob = exact(retention, RETENTION_KEYS)
    ? retention.job : undefined;
  if (body.created_at !== timestamp
    || !thresholdKeys.every((key) => boundedPositive(thresholds[key]))
    || !exact(totals, TOTAL_KEYS)
    || !TOTAL_KEYS.every((key) => boundedNonnegative(totals[key]))
    || !exact(circuit, CIRCUIT_KEYS)
    || !["CLOSED", "OPEN", "HALF_OPEN"].includes(String(circuit.state))
    || !boundedNonnegative(circuit.consecutive_failures)
    || !boundedNonnegative(circuit.active_permits)
    || !boundedPositive(circuit.max_concurrent)
    || (circuit.max_concurrent as number) > 100
    || (circuit.active_permits as number) > (circuit.max_concurrent as number)
    || !boundedPositive(circuit.failure_threshold)
    || (circuit.failure_threshold as number) > 20
    || (circuit.state === "CLOSED"
      && (circuit.consecutive_failures as number)
        >= (circuit.failure_threshold as number))
    || (circuit.state !== "CLOSED"
      && (circuit.consecutive_failures as number)
        < (circuit.failure_threshold as number))
    || (alertHealth.oldest_unresolved_age_seconds !== null
      && !boundedNonnegative(alertHealth.oldest_unresolved_age_seconds))
    || (isV3 && (!exact(retention, RETENTION_KEYS)
      || !boundedNonnegative(retention.eligible_expired)
      || !boundedNonnegative(retention.blocked_expired)
      || (retention.oldest_blocked_expired_age_seconds !== null
        && !boundedNonnegative(
          retention.oldest_blocked_expired_age_seconds,
        ))
      || !exact(retentionJob, RETENTION_JOB_KEYS)
      || typeof retentionJob.active !== "boolean"
      || !["inactive", "healthy", "attention", "critical"]
        .includes(String(retentionJob.status))
      || !["NEVER", "RUNNING", "STALE_RUNNING", "SUCCEEDED", "FAILED"]
        .includes(String(retentionJob.last_run_status))
      || typeof retentionJob.overdue !== "boolean"
      || typeof retentionJob.lease_stale !== "boolean"
      || !boundedNonnegative(retentionJob.last_deleted_snapshots)
      || retentionJob.interval_seconds !== 86_400
      || retentionJob.max_start_delay_seconds !== 93_600
      || retentionJob.lease_stale
        !== (retentionJob.last_run_status === "STALE_RUNNING")
      || retentionJob.status !== (!retentionJob.active ? "inactive"
        : retentionJob.lease_stale ? "critical"
          : retentionJob.last_run_status === "FAILED" || retentionJob.overdue
            ? "attention" : "healthy")))
    || !Array.isArray(body.reasons)
    || body.reasons.some((reason) => typeof reason !== "string")
    || new Set(body.reasons).size !== body.reasons.length) {
    return { ok: false, error: "INVALID_ALERT_BODY" };
  }
  const reasons = body.reasons as string[];
  const firingReasons = expectedReasons(
    totals, thresholds, circuit,
    isV3 ? retention as Record<string, unknown> : undefined,
    isV3 ? retentionJob as Record<string, unknown> : undefined,
  );
  const critical = firingReasons.includes("scanner_circuit_open")
    || firingReasons.includes("alert_snapshot_retention_job_stale")
    || firingReasons.includes("alert_snapshot_retention_blocked")
    || firingReasons.includes("scan_retry_exhausted")
    || firingReasons.includes("scan_retry_expired_quarantine");
  const validFiring = body.state === "firing"
    && body.severity === (critical ? "critical" : "warning")
    && firingReasons.length > 0
    && reasons.join("|") === firingReasons.join("|")
    && reasons.every((reason) => FIRING_REASONS.includes(reason));
  const validRecovery = body.state === "recovered"
    && body.severity === "recovery" && firingReasons.length === 0
    && reasons.length === 1
    && reasons[0] === (isV3
      ? "scanner_scan_retry_and_retention_recovered"
      : "scanner_and_scan_retry_recovered");
  if (!validFiring && !validRecovery) {
    return { ok: false, error: "INVALID_ALERT_BODY" };
  }
  const secrets = Array.isArray(input.secret) ? input.secret : [input.secret];
  if (secrets.length < 1 || secrets.length > 4
    || new Set(secrets).size !== secrets.length) {
    return { ok: false, error: "INVALID_ALERT_SIGNATURE" };
  }
  const validSignature = secrets.some((secret) => {
    if (secret.length < 16 || secret.length > 128) return false;
    const expected = Buffer.from(signWebhookClaimAlertPayload(
      secret, timestamp, raw,
    ));
    const received = Buffer.from(signature);
    return expected.length === received.length
      && timingSafeEqual(expected, received);
  });
  if (!validSignature) {
    return { ok: false, error: "INVALID_ALERT_SIGNATURE" };
  }
  const semanticPayload = JSON.stringify({
    schema_version: body.schema_version,
    type: body.type,
    delivery_id: body.delivery_id,
    state: body.state,
    severity: body.severity,
    reasons: body.reasons,
    thresholds: body.thresholds,
    health: body.health,
  });
  return {
    ok: true,
    deliveryId,
    state: body.state as "firing" | "recovered",
    severity: body.severity as "warning" | "critical" | "recovery",
    payloadSha256: createHash("sha256").update(semanticPayload).digest("hex"),
  };
}

export async function claimVerifiedDisputeEvidenceScanRetryAlert(
  db: Database,
  verification: Extract<DisputeEvidenceScanRetryAlertVerification, { ok: true }>,
  source = DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_SOURCE,
) {
  const claim = await claimDisputeEvidenceScanRetryAlert(
    db, verification, source,
  );
  if (claim.outcome === "acquired") {
    await completeWebhookEvent(db, claim, 204);
  }
  return claim;
}

export async function claimDisputeEvidenceScanRetryAlert(
  db: Database,
  verification: Extract<DisputeEvidenceScanRetryAlertVerification, { ok: true }>,
  source = DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_SOURCE,
) {
  return claimWebhookEvent(db, {
    source,
    eventId: verification.deliveryId,
    payloadSha256: verification.payloadSha256,
  });
}
