import { createHash } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { assertDisputeModuleOutboundUrl } from
  "./dispute-module-outbound-url.service.js";
import type { getDisputeEvidenceScanRetryHealth } from
  "./dispute-evidence-scan-retry.service.js";
import type { getDisputeEvidenceScannerCircuitHealth } from
  "./dispute-evidence-scanner-circuit.service.js";
import type { getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth } from
  "./dispute-evidence-scan-retry-alert-snapshot-retention.service.js";
import type { getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth } from
  "../jobs/dispute-evidence-scan-retry-alert-snapshot-retention.js";
import { signWebhookClaimAlertPayload } from
  "./webhook-claim-alert.service.js";

export type DisputeEvidenceScanRetryHealth = Awaited<ReturnType<
  typeof getDisputeEvidenceScanRetryHealth
>>;
export type DisputeEvidenceScannerCircuitHealth = Awaited<ReturnType<
  typeof getDisputeEvidenceScannerCircuitHealth
>>;
export type DisputeEvidenceScanRetryAlertSnapshotRetentionHealth = Awaited<
  ReturnType<typeof getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth>
>;
export type DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth = Awaited<
  ReturnType<typeof getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth>
>;

export interface DisputeEvidenceScanRetryAlertConfig {
  url: string;
  secret: string;
  timeoutMs: number;
  cooldownMinutes: number;
  retryReadyThreshold: number;
  staleThreshold: number;
  exhaustedThreshold: number;
  expiredThreshold: number;
  retentionBlockedThreshold: number;
  allowInsecureHttp: boolean;
  allowPrivateNetwork: boolean;
}

export interface DisputeEvidenceScanRetryAlertAssessment {
  wouldAlert: boolean;
  severity: "warning" | "critical" | "recovery" | null;
  reasons: string[];
}

export interface DisputeEvidenceScanRetryAlertSnapshot {
  schema_version: "dispute-evidence-scan-retry-alert-v2"
    | "dispute-evidence-scan-retry-alert-v3";
  type: "dispute_evidence_scan_retry.health";
  delivery_id: string;
  state: "firing" | "recovered";
  severity: "warning" | "critical" | "recovery";
  reasons: string[];
  thresholds: {
    retry_ready: number;
    stale_processing: number;
    exhausted: number;
    expired_quarantined: number;
    retention_blocked_expired?: number;
  };
  health: {
    totals: Record<string, number>;
    oldest_unresolved_age_seconds: number | null;
    circuit: {
      state: "CLOSED" | "OPEN" | "HALF_OPEN";
      consecutive_failures: number;
      active_permits: number;
      max_concurrent: number;
      failure_threshold: number;
    };
    retention?: {
      eligible_expired: number;
      blocked_expired: number;
      oldest_blocked_expired_age_seconds: number | null;
      job: {
        active: boolean;
        status: "inactive" | "healthy" | "attention" | "critical";
        last_run_status: "NEVER" | "RUNNING" | "STALE_RUNNING"
          | "SUCCEEDED" | "FAILED";
        overdue: boolean;
        lease_stale: boolean;
        last_deleted_snapshots: number;
        interval_seconds: number;
        max_start_delay_seconds: number;
      };
    };
  };
}

export const DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SOURCE =
  "haggle-dispute-evidence-scan-retry-alert";

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max
    ? value : fallback;
}

export function getDisputeEvidenceScanRetryAlertPolicyStatus() {
  const url = process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_URL?.trim() ?? "";
  const secret = process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET ?? "";
  const allowInsecureHttp =
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_ALLOW_INSECURE_HTTP === "true";
  const allowPrivateNetwork =
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_ALLOW_PRIVATE_NETWORK === "true";
  let configurationState: "not_configured" | "partial" | "invalid" | "valid" =
    !url && !secret ? "not_configured" : !url || secret.length < 16
      || secret.length > 128 ? "partial" : "valid";
  if (configurationState === "valid") {
    try {
      assertDisputeModuleOutboundUrl(url, {
        label: "dispute evidence scan retry alert",
        allowInsecureHttp,
        allowPrivateNetwork,
      });
    } catch {
      configurationState = "invalid";
    }
  }
  return {
    configured: configurationState === "valid",
    configurationState,
    jobEnabled:
      process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB === "true",
    cooldownMinutes: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_COOLDOWN_MINUTES,
      15, 1, 1_440,
    ),
    retryReadyThreshold: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RETRY_READY_THRESHOLD,
      10, 1, 100_000,
    ),
    staleThreshold: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_STALE_THRESHOLD,
      1, 1, 100_000,
    ),
    exhaustedThreshold: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_EXHAUSTED_THRESHOLD,
      1, 1, 100_000,
    ),
    expiredThreshold: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_EXPIRED_THRESHOLD,
      1, 1, 100_000,
    ),
    retentionBlockedThreshold: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RETENTION_BLOCKED_THRESHOLD,
      1, 1, 100_000,
    ),
  };
}

export function resolveDisputeEvidenceScanRetryAlertConfigFromEnv():
DisputeEvidenceScanRetryAlertConfig | null {
  const url = process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_URL?.trim();
  if (!url) return null;
  const secret = process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET ?? "";
  if (secret.length < 16 || secret.length > 128) {
    throw new Error(
      "dispute evidence scan retry alert secret must be 16..128 characters",
    );
  }
  const allowInsecureHttp =
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_ALLOW_INSECURE_HTTP === "true";
  const allowPrivateNetwork =
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_ALLOW_PRIVATE_NETWORK === "true";
  const policy = getDisputeEvidenceScanRetryAlertPolicyStatus();
  const config = {
    url,
    secret,
    timeoutMs: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_TIMEOUT_MS,
      5_000, 250, 30_000,
    ),
    cooldownMinutes: policy.cooldownMinutes,
    retryReadyThreshold: policy.retryReadyThreshold,
    staleThreshold: policy.staleThreshold,
    exhaustedThreshold: policy.exhaustedThreshold,
    expiredThreshold: policy.expiredThreshold,
    retentionBlockedThreshold: policy.retentionBlockedThreshold,
    allowInsecureHttp,
    allowPrivateNetwork,
  } satisfies DisputeEvidenceScanRetryAlertConfig;
  assertDisputeModuleOutboundUrl(config.url, {
    label: "dispute evidence scan retry alert",
    allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  return config;
}

export function evaluateDisputeEvidenceScanRetryAlert(
  health: DisputeEvidenceScanRetryHealth,
  circuit: DisputeEvidenceScannerCircuitHealth,
  policy: Pick<DisputeEvidenceScanRetryAlertConfig,
    "retryReadyThreshold" | "staleThreshold" | "exhaustedThreshold"
    | "expiredThreshold" | "retentionBlockedThreshold">,
  retention: DisputeEvidenceScanRetryAlertSnapshotRetentionHealth,
  retentionJob: DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth,
): DisputeEvidenceScanRetryAlertAssessment {
  const retentionActive = retentionJob.policy.jobEnabled
    && retentionJob.policy.cronEnabled;
  const reasons = [
    ...(circuit.state === "OPEN" ? ["scanner_circuit_open"] : []),
    ...(circuit.state === "HALF_OPEN"
      ? ["scanner_circuit_half_open"] : []),
    ...(retentionActive && retentionJob.lastRunStatus === "STALE_RUNNING"
      ? ["alert_snapshot_retention_job_stale"] : []),
    ...(retention.blockedExpired >= policy.retentionBlockedThreshold
      ? ["alert_snapshot_retention_blocked"] : []),
    ...(health.totals.exhausted >= policy.exhaustedThreshold
      ? ["scan_retry_exhausted"] : []),
    ...(health.totals.expiredQuarantined >= policy.expiredThreshold
      ? ["scan_retry_expired_quarantine"] : []),
    ...(health.totals.staleProcessing >= policy.staleThreshold
      ? ["scan_retry_stale_processing"] : []),
    ...(health.totals.retryReady >= policy.retryReadyThreshold
      ? ["scan_retry_ready_backlog"] : []),
    ...(retentionActive && retentionJob.lastRunStatus === "FAILED"
      ? ["alert_snapshot_retention_job_failed"] : []),
    ...(retentionActive && retentionJob.overdue
      ? ["alert_snapshot_retention_job_overdue"] : []),
  ];
  const critical = reasons.includes("scanner_circuit_open")
    || reasons.includes("alert_snapshot_retention_job_stale")
    || reasons.includes("alert_snapshot_retention_blocked")
    || reasons.includes("scan_retry_exhausted")
    || reasons.includes("scan_retry_expired_quarantine");
  return {
    wouldAlert: reasons.length > 0,
    severity: critical ? "critical" : reasons.length ? "warning" : null,
    reasons,
  };
}

export async function getDisputeEvidenceScanRetryAlertDeliveryState(
  db: Database,
  source = DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SOURCE,
) {
  const rows = await db.execute(sql`
    SELECT max(completed_at) FILTER (
             WHERE left(idempotency_key, 7) = 'health_'
           ) AS "lastIncidentAt",
           max(completed_at) FILTER (
             WHERE left(idempotency_key, 9) = 'recovery_'
           ) AS "lastRecoveryAt"
      FROM webhook_idempotency
     WHERE source = ${source} AND status = 'COMPLETED'
  `) as unknown as Array<{
    lastIncidentAt: Date | string | null;
    lastRecoveryAt: Date | string | null;
  }>;
  const incident = rows[0]?.lastIncidentAt
    ? new Date(rows[0].lastIncidentAt) : null;
  const recovery = rows[0]?.lastRecoveryAt
    ? new Date(rows[0].lastRecoveryAt) : null;
  return {
    incidentOpen: Boolean(incident && (!recovery || recovery < incident)),
    lastIncidentAlertAt: incident?.toISOString() ?? null,
    lastRecoveryAlertAt: recovery?.toISOString() ?? null,
  };
}

export async function getDisputeEvidenceScanRetryAlertSenderHealth(
  db: Database,
  source = DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SOURCE,
) {
  const [rows, snapshotRows] = await Promise.all([
    db.execute(sql`
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
  `) as unknown as Promise<Array<Record<string, number | string | Date | null>>>,
    db.execute(sql`
      SELECT count(s.id)::int AS "snapshotCount",
             count(s.id) FILTER (WHERE w.id IS NULL)::int AS "orphanedSnapshots",
             count(s.id) FILTER (
               WHERE w.id IS NULL
                  OR (w.status = 'FAILED'
                    AND (w.next_attempt_at IS NULL OR w.next_attempt_at <= now()))
                  OR (w.status = 'PROCESSING' AND w.lease_expires_at <= now())
             )::int AS "retryableSnapshots",
             count(s.id) FILTER (
               WHERE w.id IS NOT NULL
                 AND w.payload_sha256 IS DISTINCT FROM s.payload_sha256
             )::int AS "bindingViolations",
             count(w.id) FILTER (
               WHERE s.id IS NULL AND (
                 (w.status = 'FAILED'
                   AND (w.next_attempt_at IS NULL OR w.next_attempt_at <= now()))
                 OR (w.status = 'PROCESSING' AND w.lease_expires_at <= now())
               )
             )::int AS "missingRetrySnapshots"
        FROM webhook_idempotency w
        FULL OUTER JOIN dispute_evidence_scan_retry_alert_snapshots s
          ON s.source = w.source AND s.delivery_id = w.idempotency_key
       WHERE coalesce(s.source, w.source) = ${source}
    `) as unknown as Promise<Array<Record<string, number | string | null>>>,
  ]);
  const row = rows[0] ?? {};
  const snapshotRow = snapshotRows[0] ?? {};
  const failed = Number(row.failed ?? 0);
  const staleProcessing = Number(row.staleProcessing ?? 0);
  const bindingViolations = Number(snapshotRow.bindingViolations ?? 0);
  const missingRetrySnapshots = Number(snapshotRow.missingRetrySnapshots ?? 0);
  const orphanedSnapshots = Number(snapshotRow.orphanedSnapshots ?? 0);
  return {
    status: staleProcessing > 0 || bindingViolations > 0
      || missingRetrySnapshots > 0 ? "critical" as const
      : failed > 0 || orphanedSnapshots > 0
        ? "warning" as const : "healthy" as const,
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
    snapshotCount: Number(snapshotRow.snapshotCount ?? 0),
    retryableSnapshots: Number(snapshotRow.retryableSnapshots ?? 0),
    orphanedSnapshots,
    missingRetrySnapshots,
    bindingViolations,
    recordedAt: new Date().toISOString(),
    containsIdentifiers: false,
  };
}

export async function findLatestDeliveredDisputeEvidenceScanRetryIncident(
  db: Database,
  source = DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SOURCE,
) {
  const rows = await db.execute(sql`
    SELECT idempotency_key AS "eventId", completed_at AS "completedAt"
      FROM webhook_idempotency
     WHERE source = ${source} AND status = 'COMPLETED'
       AND left(idempotency_key, 7) = 'health_'
     ORDER BY completed_at DESC, id DESC
     LIMIT 1
  `) as unknown as Array<{
    eventId: string;
    completedAt: Date | string;
  }>;
  const row = rows[0];
  return row ? {
    eventId: row.eventId,
    completedAt: new Date(row.completedAt).toISOString(),
  } : null;
}

function publicHealth(
  health: DisputeEvidenceScanRetryHealth,
  circuit: DisputeEvidenceScannerCircuitHealth,
  retention?: DisputeEvidenceScanRetryAlertSnapshotRetentionHealth,
  retentionJob?: DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth,
) {
  const result: DisputeEvidenceScanRetryAlertSnapshot["health"] = {
    totals: {
      quarantined: health.totals.quarantined,
      pending: health.totals.pending,
      failed: health.totals.failed,
      processing: health.totals.processing,
      stale_processing: health.totals.staleProcessing,
      retry_ready: health.totals.retryReady,
      exhausted: health.totals.exhausted,
      expired_quarantined: health.totals.expiredQuarantined,
    },
    oldest_unresolved_age_seconds: health.oldestUnresolvedAgeSeconds,
    circuit: {
      state: circuit.state,
      consecutive_failures: circuit.consecutiveFailures,
      active_permits: circuit.activePermits,
      max_concurrent: circuit.policy.maxConcurrent,
      failure_threshold: circuit.policy.failureThreshold,
    },
  };
  if (retention && retentionJob) {
    result.retention = {
      eligible_expired: retention.eligibleExpired,
      blocked_expired: retention.blockedExpired,
      oldest_blocked_expired_age_seconds:
        retention.oldestBlockedExpiredAgeSeconds,
      job: {
        active: retentionJob.policy.jobEnabled
          && retentionJob.policy.cronEnabled,
        status: retentionJob.status,
        last_run_status: retentionJob.lastRunStatus,
        overdue: retentionJob.overdue,
        lease_stale: retentionJob.leaseStale,
        last_deleted_snapshots: retentionJob.lastDeletedSnapshots,
        interval_seconds: retentionJob.policy.intervalSeconds,
        max_start_delay_seconds: retentionJob.policy.maxStartDelaySeconds,
      },
    };
  }
  return result;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length
    && [...keys].sort().every((key, index) => key === actual[index]);
}

function snapshotPayloadSha256(
  snapshot: DisputeEvidenceScanRetryAlertSnapshot,
): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function createDisputeEvidenceScanRetryAlertSnapshot(
  health: DisputeEvidenceScanRetryHealth,
  circuit: DisputeEvidenceScannerCircuitHealth,
  assessment: DisputeEvidenceScanRetryAlertAssessment,
  config: DisputeEvidenceScanRetryAlertConfig,
  deliveryId: string,
  retention: DisputeEvidenceScanRetryAlertSnapshotRetentionHealth,
  retentionJob: DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth,
): DisputeEvidenceScanRetryAlertSnapshot {
  if (!/^(?:health|recovery)_[0-9a-f]{64}$/.test(deliveryId)
    || !assessment.severity || !assessment.wouldAlert) {
    throw new Error("invalid dispute evidence scan retry alert snapshot");
  }
  return {
    schema_version: "dispute-evidence-scan-retry-alert-v3",
    type: "dispute_evidence_scan_retry.health",
    delivery_id: deliveryId,
    state: assessment.severity === "recovery" ? "recovered" : "firing",
    severity: assessment.severity,
    reasons: [...assessment.reasons],
    thresholds: {
      retry_ready: config.retryReadyThreshold,
      stale_processing: config.staleThreshold,
      exhausted: config.exhaustedThreshold,
      expired_quarantined: config.expiredThreshold,
      retention_blocked_expired: config.retentionBlockedThreshold,
    },
    health: publicHealth(health, circuit, retention, retentionJob),
  };
}

function normalizeDisputeEvidenceScanRetryAlertSnapshot(
  value: unknown,
): DisputeEvidenceScanRetryAlertSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SNAPSHOT_INVALID");
  }
  const input = value as Record<string, unknown>;
  const thresholds = input.thresholds as Record<string, unknown> | undefined;
  const health = input.health as Record<string, unknown> | undefined;
  const totals = health?.totals as Record<string, unknown> | undefined;
  const circuit = health?.circuit as Record<string, unknown> | undefined;
  const retention = health?.retention as Record<string, unknown> | undefined;
  const retentionJob = retention?.job as Record<string, unknown> | undefined;
  const reasons = input.reasons;
  const numberKeys = (record: Record<string, unknown> | undefined,
    keys: string[]) => Boolean(record && keys.every((key) =>
      typeof record[key] === "number" && Number.isFinite(record[key])));
  const totalKeys = ["quarantined", "pending", "failed", "processing",
    "stale_processing", "retry_ready", "exhausted", "expired_quarantined"];
  const thresholdKeys = ["retry_ready", "stale_processing", "exhausted",
    "expired_quarantined"];
  const isV3 = input.schema_version
    === "dispute-evidence-scan-retry-alert-v3";
  const expectedThresholdKeys = isV3
    ? [...thresholdKeys, "retention_blocked_expired"] : thresholdKeys;
  const expectedHealthKeys = isV3
    ? ["totals", "oldest_unresolved_age_seconds", "circuit", "retention"]
    : ["totals", "oldest_unresolved_age_seconds", "circuit"];
  const circuitKeys = ["state", "consecutive_failures", "active_permits",
    "max_concurrent", "failure_threshold"];
  const retentionKeys = ["eligible_expired", "blocked_expired",
    "oldest_blocked_expired_age_seconds", "job"];
  const retentionJobKeys = ["active", "status", "last_run_status", "overdue",
    "lease_stale", "last_deleted_snapshots", "interval_seconds",
    "max_start_delay_seconds"];
  if (!exactKeys(input, ["schema_version", "type", "delivery_id", "state",
    "severity", "reasons", "thresholds", "health"])
    || !["dispute-evidence-scan-retry-alert-v2",
      "dispute-evidence-scan-retry-alert-v3"].includes(
        String(input.schema_version),
      )
    || input.type !== "dispute_evidence_scan_retry.health"
    || typeof input.delivery_id !== "string"
    || !/^(?:health|recovery)_[0-9a-f]{64}$/.test(input.delivery_id)
    || !["firing", "recovered"].includes(String(input.state))
    || !["warning", "critical", "recovery"].includes(String(input.severity))
    || !Array.isArray(reasons) || reasons.some((reason) =>
      typeof reason !== "string")
    || !thresholds || !exactKeys(thresholds, expectedThresholdKeys)
    || !numberKeys(thresholds, expectedThresholdKeys)
    || !health || !exactKeys(health, expectedHealthKeys)
    || !totals || !exactKeys(totals, totalKeys)
    || !numberKeys(totals, totalKeys)
    || (health.oldest_unresolved_age_seconds !== null
      && (typeof health.oldest_unresolved_age_seconds !== "number"
        || !Number.isFinite(health.oldest_unresolved_age_seconds)))
    || !circuit || !exactKeys(circuit, circuitKeys)
    || !["CLOSED", "OPEN", "HALF_OPEN"].includes(String(circuit.state))
    || !numberKeys(circuit, circuitKeys.slice(1))
    || (isV3 && (!retention || !exactKeys(retention, retentionKeys)
      || !numberKeys(retention, ["eligible_expired", "blocked_expired"])
      || (retention.oldest_blocked_expired_age_seconds !== null
        && (typeof retention.oldest_blocked_expired_age_seconds !== "number"
          || !Number.isFinite(retention.oldest_blocked_expired_age_seconds)))
      || !retentionJob || !exactKeys(retentionJob, retentionJobKeys)
      || typeof retentionJob.active !== "boolean"
      || !["inactive", "healthy", "attention", "critical"]
        .includes(String(retentionJob.status))
      || !["NEVER", "RUNNING", "STALE_RUNNING", "SUCCEEDED", "FAILED"]
        .includes(String(retentionJob.last_run_status))
      || typeof retentionJob.overdue !== "boolean"
      || typeof retentionJob.lease_stale !== "boolean"
      || !numberKeys(retentionJob, ["last_deleted_snapshots",
        "interval_seconds", "max_start_delay_seconds"])))) {
    throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SNAPSHOT_INVALID");
  }
  const normalized: DisputeEvidenceScanRetryAlertSnapshot = {
    schema_version: input.schema_version as
      DisputeEvidenceScanRetryAlertSnapshot["schema_version"],
    type: "dispute_evidence_scan_retry.health",
    delivery_id: input.delivery_id,
    state: input.state as "firing" | "recovered",
    severity: input.severity as "warning" | "critical" | "recovery",
    reasons: [...reasons] as string[],
    thresholds: {
      retry_ready: Number(thresholds.retry_ready),
      stale_processing: Number(thresholds.stale_processing),
      exhausted: Number(thresholds.exhausted),
      expired_quarantined: Number(thresholds.expired_quarantined),
    },
    health: {
      totals: Object.fromEntries(totalKeys.map((key) =>
        [key, Number(totals[key])])),
      oldest_unresolved_age_seconds:
        health.oldest_unresolved_age_seconds as number | null,
      circuit: {
        state: circuit.state as "CLOSED" | "OPEN" | "HALF_OPEN",
        consecutive_failures: Number(circuit.consecutive_failures),
        active_permits: Number(circuit.active_permits),
        max_concurrent: Number(circuit.max_concurrent),
        failure_threshold: Number(circuit.failure_threshold),
      },
    },
  };
  if (isV3 && retention && retentionJob) {
    normalized.thresholds.retention_blocked_expired = Number(
      thresholds.retention_blocked_expired,
    );
    normalized.health.retention = {
      eligible_expired: Number(retention.eligible_expired),
      blocked_expired: Number(retention.blocked_expired),
      oldest_blocked_expired_age_seconds:
        retention.oldest_blocked_expired_age_seconds as number | null,
      job: {
        active: retentionJob.active as boolean,
        status: retentionJob.status as
          NonNullable<DisputeEvidenceScanRetryAlertSnapshot["health"]["retention"]>["job"]["status"],
        last_run_status: retentionJob.last_run_status as
          NonNullable<DisputeEvidenceScanRetryAlertSnapshot["health"]["retention"]>["job"]["last_run_status"],
        overdue: retentionJob.overdue as boolean,
        lease_stale: retentionJob.lease_stale as boolean,
        last_deleted_snapshots: Number(retentionJob.last_deleted_snapshots),
        interval_seconds: Number(retentionJob.interval_seconds),
        max_start_delay_seconds: Number(
          retentionJob.max_start_delay_seconds,
        ),
      },
    };
  }
  const positiveInteger = (value: number, max: number) =>
    Number.isSafeInteger(value) && value >= 1 && value <= max;
  const nonnegativeInteger = (value: number, max: number) =>
    Number.isSafeInteger(value) && value >= 0 && value <= max;
  if (!Object.values(normalized.thresholds).every((value) =>
    positiveInteger(value, 100_000))
    || !Object.values(normalized.health.totals).every((value) =>
      nonnegativeInteger(value, 1_000_000_000))
    || (normalized.health.oldest_unresolved_age_seconds !== null
      && !nonnegativeInteger(
        normalized.health.oldest_unresolved_age_seconds, 31_536_000,
      ))
    || !nonnegativeInteger(
      normalized.health.circuit.consecutive_failures, 1_000,
    )
    || !nonnegativeInteger(normalized.health.circuit.active_permits, 100)
    || !positiveInteger(normalized.health.circuit.max_concurrent, 100)
    || normalized.health.circuit.active_permits
      > normalized.health.circuit.max_concurrent
    || !positiveInteger(normalized.health.circuit.failure_threshold, 20)
    || (normalized.health.circuit.state === "CLOSED"
      && normalized.health.circuit.consecutive_failures
        >= normalized.health.circuit.failure_threshold)
    || (normalized.health.circuit.state !== "CLOSED"
      && normalized.health.circuit.consecutive_failures
        < normalized.health.circuit.failure_threshold)
    || (isV3 && (!normalized.health.retention
      || !nonnegativeInteger(
        normalized.health.retention.eligible_expired, 1_000_000_000,
      )
      || !nonnegativeInteger(
        normalized.health.retention.blocked_expired, 1_000_000_000,
      )
      || (normalized.health.retention.oldest_blocked_expired_age_seconds
        !== null && !nonnegativeInteger(
          normalized.health.retention.oldest_blocked_expired_age_seconds,
          315_360_000,
        ))
      || !nonnegativeInteger(
        normalized.health.retention.job.last_deleted_snapshots,
        1_000_000_000,
      )
      || normalized.health.retention.job.interval_seconds !== 86_400
      || normalized.health.retention.job.max_start_delay_seconds !== 93_600
      || normalized.health.retention.job.lease_stale
        !== (normalized.health.retention.job.last_run_status
          === "STALE_RUNNING")
      || normalized.health.retention.job.status
        !== (!normalized.health.retention.job.active ? "inactive"
          : normalized.health.retention.job.lease_stale ? "critical"
            : normalized.health.retention.job.last_run_status === "FAILED"
              || normalized.health.retention.job.overdue ? "attention"
              : "healthy")))) {
    throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SNAPSHOT_INVALID");
  }
  const expectedReasons = [
    ...(normalized.health.circuit.state === "OPEN"
      ? ["scanner_circuit_open"] : []),
    ...(normalized.health.circuit.state === "HALF_OPEN"
      ? ["scanner_circuit_half_open"] : []),
    ...(isV3 && normalized.health.retention?.job.active
      && normalized.health.retention.job.last_run_status === "STALE_RUNNING"
      ? ["alert_snapshot_retention_job_stale"] : []),
    ...(isV3 && normalized.health.retention
      && normalized.thresholds.retention_blocked_expired !== undefined
      && normalized.health.retention.blocked_expired
        >= normalized.thresholds.retention_blocked_expired
      ? ["alert_snapshot_retention_blocked"] : []),
    ...(normalized.health.totals.exhausted
      >= normalized.thresholds.exhausted ? ["scan_retry_exhausted"] : []),
    ...(normalized.health.totals.expired_quarantined
      >= normalized.thresholds.expired_quarantined
      ? ["scan_retry_expired_quarantine"] : []),
    ...(normalized.health.totals.stale_processing
      >= normalized.thresholds.stale_processing
      ? ["scan_retry_stale_processing"] : []),
    ...(normalized.health.totals.retry_ready
      >= normalized.thresholds.retry_ready
      ? ["scan_retry_ready_backlog"] : []),
    ...(isV3 && normalized.health.retention?.job.active
      && normalized.health.retention.job.last_run_status === "FAILED"
      ? ["alert_snapshot_retention_job_failed"] : []),
    ...(isV3 && normalized.health.retention?.job.active
      && normalized.health.retention.job.overdue
      ? ["alert_snapshot_retention_job_overdue"] : []),
  ];
  const critical = expectedReasons.includes("scanner_circuit_open")
    || expectedReasons.includes("alert_snapshot_retention_job_stale")
    || expectedReasons.includes("alert_snapshot_retention_blocked")
    || expectedReasons.includes("scan_retry_exhausted")
    || expectedReasons.includes("scan_retry_expired_quarantine");
  const firingValid = normalized.state === "firing"
    && normalized.severity === (critical ? "critical" : "warning")
    && expectedReasons.length > 0
    && normalized.reasons.join("|") === expectedReasons.join("|");
  const recoveryValid = normalized.state === "recovered"
    && normalized.severity === "recovery"
    && expectedReasons.length === 0
    && normalized.reasons.length === 1
    && normalized.reasons[0] === (isV3
      ? "scanner_scan_retry_and_retention_recovered"
      : "scanner_and_scan_retry_recovered");
  if (!firingValid && !recoveryValid) {
    throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SNAPSHOT_INVALID");
  }
  return normalized;
}

export async function persistDisputeEvidenceScanRetryAlertSnapshot(
  db: Database,
  source: string,
  snapshot: DisputeEvidenceScanRetryAlertSnapshot,
) {
  const normalizedInput = normalizeDisputeEvidenceScanRetryAlertSnapshot(
    snapshot,
  );
  const payloadSha256 = snapshotPayloadSha256(normalizedInput);
  const rows = await db.execute(sql`
    INSERT INTO dispute_evidence_scan_retry_alert_snapshots
      (source, delivery_id, snapshot_kind, payload, payload_sha256,
       created_at, expires_at)
    VALUES (${source}, ${snapshot.delivery_id},
      ${normalizedInput.state === "firing" ? "FIRING" : "RECOVERY"},
      ${JSON.stringify(normalizedInput)}::jsonb, ${payloadSha256}, now(),
      now() + interval '30 days')
    ON CONFLICT (source, delivery_id) DO NOTHING
    RETURNING payload, payload_sha256 AS "payloadSha256"
  `) as unknown as Array<{ payload: unknown; payloadSha256: string }>;
  const existing = rows[0] ?? (await db.execute(sql`
    SELECT payload, payload_sha256 AS "payloadSha256"
      FROM dispute_evidence_scan_retry_alert_snapshots
     WHERE source = ${source} AND delivery_id = ${snapshot.delivery_id}
     LIMIT 1
  `) as unknown as Array<{ payload: unknown; payloadSha256: string }>)[0];
  if (!existing) throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SNAPSHOT_MISSING");
  const normalized = normalizeDisputeEvidenceScanRetryAlertSnapshot(
    existing.payload,
  );
  if (existing.payloadSha256 !== payloadSha256
    || snapshotPayloadSha256(normalized) !== payloadSha256) {
    throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SNAPSHOT_CONFLICT");
  }
  return { snapshot: normalized, payloadSha256 };
}

export async function findRetryableDisputeEvidenceScanRetryAlertSnapshot(
  db: Database,
  source = DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SOURCE,
) {
  const rows = await db.execute(sql`
    SELECT s.payload, s.payload_sha256 AS "payloadSha256"
      FROM dispute_evidence_scan_retry_alert_snapshots s
      LEFT JOIN webhook_idempotency w
        ON w.source = s.source AND w.idempotency_key = s.delivery_id
     WHERE s.source = ${source} AND s.expires_at > now()
       AND (
         w.id IS NULL
         OR w.status IN ('FAILED', 'PROCESSING')
       )
     ORDER BY s.created_at ASC, s.id ASC
     LIMIT 1
  `) as unknown as Array<{ payload: unknown; payloadSha256: string }>;
  const row = rows[0];
  if (!row) return null;
  const snapshot = normalizeDisputeEvidenceScanRetryAlertSnapshot(row.payload);
  if (snapshotPayloadSha256(snapshot) !== row.payloadSha256) {
    throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SNAPSHOT_INTEGRITY_FAILED");
  }
  return { snapshot, payloadSha256: row.payloadSha256 };
}

export async function hasRecentDeliveredDisputeEvidenceScanRetryIncident(
  db: Database,
  source: string,
  cooldownMinutes: number,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1
        FROM webhook_idempotency w
        JOIN dispute_evidence_scan_retry_alert_snapshots s
          ON s.source = w.source AND s.delivery_id = w.idempotency_key
       WHERE w.source = ${source}
         AND w.status = 'COMPLETED'
         AND s.snapshot_kind = 'FIRING'
         AND w.completed_at > now()
           - (${cooldownMinutes} * interval '1 minute')
    ) AS active
  `) as unknown as Array<{ active: boolean }>;
  return rows[0]?.active === true;
}

export async function sendDisputeEvidenceScanRetryAlert(
  health: DisputeEvidenceScanRetryHealth,
  circuit: DisputeEvidenceScannerCircuitHealth,
  assessment: DisputeEvidenceScanRetryAlertAssessment,
  options: {
    config: DisputeEvidenceScanRetryAlertConfig;
    deliveryId: string;
    snapshot?: DisputeEvidenceScanRetryAlertSnapshot;
    retention?: DisputeEvidenceScanRetryAlertSnapshotRetentionHealth;
    retentionJob?: DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth;
    fetchImpl?: typeof fetch;
    now?: Date;
  },
) {
  if (!/^(?:health|recovery)_[0-9a-f]{64}$/.test(options.deliveryId)) {
    throw new Error("invalid dispute evidence scan retry alert delivery id");
  }
  assertDisputeModuleOutboundUrl(options.config.url, {
    label: "dispute evidence scan retry alert",
    allowInsecureHttp: options.config.allowInsecureHttp,
    allowPrivateNetwork: options.config.allowPrivateNetwork,
  });
  if (!options.snapshot && (!options.retention || !options.retentionJob)) {
    throw new Error("dispute evidence scan retry retention health required");
  }
  const snapshot = options.snapshot ?? createDisputeEvidenceScanRetryAlertSnapshot(
    health, circuit, assessment, options.config, options.deliveryId,
    options.retention!, options.retentionJob!,
  );
  const verifiedSnapshot = normalizeDisputeEvidenceScanRetryAlertSnapshot(
    snapshot,
  );
  if (verifiedSnapshot.delivery_id !== options.deliveryId) {
    throw new Error("dispute evidence scan retry alert snapshot mismatch");
  }
  const timestamp = (options.now ?? new Date()).toISOString();
  const rawBody = JSON.stringify({
    schema_version: verifiedSnapshot.schema_version,
    type: verifiedSnapshot.type,
    delivery_id: verifiedSnapshot.delivery_id,
    state: verifiedSnapshot.state,
    created_at: timestamp,
    severity: verifiedSnapshot.severity,
    reasons: verifiedSnapshot.reasons,
    thresholds: verifiedSnapshot.thresholds,
    health: verifiedSnapshot.health,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.config.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(options.config.url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-haggle-alert-type": "dispute_evidence_scan_retry.health",
        "x-haggle-alert-delivery-id": options.deliveryId,
        "x-haggle-alert-timestamp": timestamp,
        "x-haggle-alert-signature": signWebhookClaimAlertPayload(
          options.config.secret, timestamp, rawBody,
        ),
      },
      body: rawBody,
    });
    return {
      status: response.ok ? "delivered" as const : "failed" as const,
      httpStatus: response.status,
    };
  } catch {
    return { status: "failed" as const, error: "ALERT_DELIVERY_FAILED" as const };
  } finally {
    clearTimeout(timeout);
  }
}
