import { randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { validateDisputeStoragePath } from "../lib/dispute-storage-paths.js";
import { downloadDisputeEvidence } from "./dispute-storage.service.js";
import {
  getDisputeEvidenceScannerPolicyStatus,
  resolveDisputeEvidenceScannerConfigFromEnv,
  scanDisputeEvidence,
  type DisputeEvidenceScanResult,
  type DisputeEvidenceScannerConfig,
} from "./dispute-evidence-scan.service.js";

export interface DisputeEvidenceScanRetryConfig {
  batchSize: number;
  maxAttempts: number;
  leaseSeconds: number;
  baseBackoffSeconds: number;
  maxBackoffSeconds: number;
}

export interface DisputeEvidenceScanRetryClaim {
  uploadId: string;
  disputeId: string;
  storagePath: string;
  contentType: string;
  fileSizeBytes: number;
  attemptCount: number;
  leaseToken: string;
  leaseExpiresAt: Date;
}

const DEFAULT_RETRY_CONFIG: DisputeEvidenceScanRetryConfig = {
  batchSize: 10,
  maxAttempts: 5,
  leaseSeconds: 60,
  baseBackoffSeconds: 30,
  maxBackoffSeconds: 3_600,
};

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function resolveDisputeEvidenceScanRetryConfigFromEnv():
DisputeEvidenceScanRetryConfig {
  const config = {
    batchSize: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_BATCH_SIZE,
      DEFAULT_RETRY_CONFIG.batchSize, 1, 100,
      "evidence scan retry batch size",
    ),
    maxAttempts: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_MAX_ATTEMPTS,
      DEFAULT_RETRY_CONFIG.maxAttempts, 1, 20,
      "evidence scan retry max attempts",
    ),
    leaseSeconds: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_LEASE_SECONDS,
      DEFAULT_RETRY_CONFIG.leaseSeconds, 30, 300,
      "evidence scan retry lease seconds",
    ),
    baseBackoffSeconds: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_BASE_BACKOFF_SECONDS,
      DEFAULT_RETRY_CONFIG.baseBackoffSeconds, 5, 3_600,
      "evidence scan retry base backoff seconds",
    ),
    maxBackoffSeconds: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_MAX_BACKOFF_SECONDS,
      DEFAULT_RETRY_CONFIG.maxBackoffSeconds, 30, 86_400,
      "evidence scan retry max backoff seconds",
    ),
  };
  if (config.maxBackoffSeconds < config.baseBackoffSeconds) {
    throw new Error(
      "evidence scan retry max backoff must be at least the base backoff",
    );
  }
  return config;
}

export function disputeEvidenceScanRetryDelaySeconds(
  attemptCount: number,
  config: DisputeEvidenceScanRetryConfig,
): number {
  const exponent = Math.max(0, Math.min(20, attemptCount - 1));
  return Math.min(
    config.maxBackoffSeconds,
    config.baseBackoffSeconds * (2 ** exponent),
  );
}

function dateValue(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export async function claimDisputeEvidenceScanRetries(
  db: Database,
  input: {
    now?: Date;
    config?: DisputeEvidenceScanRetryConfig;
  } = {},
): Promise<DisputeEvidenceScanRetryClaim[]> {
  const now = input.now ?? new Date();
  const config = input.config ?? resolveDisputeEvidenceScanRetryConfigFromEnv();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(
    now.getTime() + config.leaseSeconds * 1_000,
  );
  const rows = await db.transaction(async (tx) => tx.execute(sql`
    WITH candidates AS (
      SELECT id
        FROM dispute_evidence_uploads
       WHERE status = 'QUARANTINED'
         AND retention_status = 'ACTIVE'
         AND expires_at > ${now.toISOString()}::timestamptz
         AND scan_attempt_count < ${config.maxAttempts}
         AND (
           (scan_status IN ('PENDING', 'FAILED')
             AND COALESCE(scan_next_attempt_at, updated_at)
               <= ${now.toISOString()}::timestamptz)
           OR
           (scan_status = 'SCANNING'
             AND scan_lease_expires_at <= ${now.toISOString()}::timestamptz)
         )
       ORDER BY COALESCE(scan_next_attempt_at, scan_lease_expires_at, updated_at), id
       LIMIT ${config.batchSize}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE dispute_evidence_uploads AS upload
       SET scan_status = 'SCANNING',
           scan_attempt_count = upload.scan_attempt_count + 1,
           scan_next_attempt_at = NULL,
           scan_lease_token = ${leaseToken}::uuid,
           scan_lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
           scan_last_error = NULL,
           scan_detail = 'SCAN_RETRY_PROCESSING',
           updated_at = ${now.toISOString()}::timestamptz
      FROM candidates
     WHERE upload.id = candidates.id
    RETURNING upload.id AS "uploadId", upload.dispute_id AS "disputeId",
      upload.storage_path AS "storagePath",
      upload.content_type AS "contentType",
      upload.file_size_bytes AS "fileSizeBytes",
      upload.scan_attempt_count AS "attemptCount",
      upload.scan_lease_token AS "leaseToken",
      upload.scan_lease_expires_at AS "leaseExpiresAt"
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    uploadId: String(row.uploadId),
    disputeId: String(row.disputeId),
    storagePath: String(row.storagePath),
    contentType: String(row.contentType),
    fileSizeBytes: Number(row.fileSizeBytes),
    attemptCount: Number(row.attemptCount),
    leaseToken: String(row.leaseToken),
    leaseExpiresAt: dateValue(row.leaseExpiresAt),
  }));
}

function boundedDetail(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);
}

export async function finalizeDisputeEvidenceScanRetry(
  db: Database,
  claim: DisputeEvidenceScanRetryClaim,
  result: DisputeEvidenceScanResult,
  input: {
    now?: Date;
    config?: DisputeEvidenceScanRetryConfig;
  } = {},
): Promise<boolean> {
  const now = input.now ?? new Date();
  const config = input.config ?? resolveDisputeEvidenceScanRetryConfigFromEnv();
  const success = result.status === "CLEAN";
  const infected = result.status === "INFECTED";
  const circuitDeferred = result.status === "PENDING"
    && result.provider === "haggle-scanner-circuit";
  const exhausted = !success && !infected
    && claim.attemptCount >= config.maxAttempts;
  const retryAt = success || infected || exhausted
    ? null
    : new Date(now.getTime()
      + disputeEvidenceScanRetryDelaySeconds(
        claim.attemptCount,
        config,
      ) * 1_000);
  const storedStatus = success ? "CLEAN"
    : infected ? "INFECTED" : "FAILED";
  const detail = boundedDetail(
    exhausted ? `SCAN_RETRY_EXHAUSTED:${result.detail}` : result.detail,
  );
  const rows = await db.execute(sql`
    UPDATE dispute_evidence_uploads
       SET status = ${infected ? "REJECTED" : "QUARANTINED"},
           scan_status = ${storedStatus},
           scan_attempt_count = CASE WHEN ${circuitDeferred}
             THEN GREATEST(0, scan_attempt_count - 1)
             ELSE scan_attempt_count END,
           content_sha256 = COALESCE(${result.sha256 ?? null}, content_sha256),
           scan_provider = ${boundedDetail(result.provider)},
           scan_detail = ${detail},
           scanned_at = ${now.toISOString()}::timestamptz,
           scan_next_attempt_at = ${retryAt?.toISOString() ?? null}::timestamptz,
           scan_lease_token = NULL,
           scan_lease_expires_at = NULL,
           scan_last_error = ${success || infected ? null : detail},
           updated_at = ${now.toISOString()}::timestamptz
     WHERE id = ${claim.uploadId}::uuid
       AND status = 'QUARANTINED'
       AND scan_status = 'SCANNING'
       AND scan_lease_token = ${claim.leaseToken}::uuid
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length === 1;
}

export async function getDisputeEvidenceScanRetryHealth(
  db: Database,
  input: { now?: Date; config?: DisputeEvidenceScanRetryConfig } = {},
) {
  const now = input.now ?? new Date();
  const config = input.config ?? resolveDisputeEvidenceScanRetryConfigFromEnv();
  const rows = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'QUARANTINED'
        AND retention_status = 'ACTIVE')::int AS "quarantined",
      count(*) FILTER (WHERE status = 'QUARANTINED'
        AND retention_status = 'ACTIVE' AND scan_status = 'PENDING')::int
        AS "pending",
      count(*) FILTER (WHERE status = 'QUARANTINED'
        AND retention_status = 'ACTIVE' AND scan_status = 'FAILED')::int
        AS "failed",
      count(*) FILTER (WHERE status = 'QUARANTINED'
        AND retention_status = 'ACTIVE' AND scan_status = 'SCANNING')::int
        AS "processing",
      count(*) FILTER (WHERE status = 'QUARANTINED'
        AND retention_status = 'ACTIVE' AND scan_status = 'SCANNING'
        AND scan_lease_expires_at <= ${now.toISOString()}::timestamptz)::int
        AS "staleProcessing",
      count(*) FILTER (WHERE status = 'QUARANTINED'
        AND retention_status = 'ACTIVE' AND expires_at > ${now.toISOString()}::timestamptz
        AND scan_attempt_count < ${config.maxAttempts}
        AND ((scan_status IN ('PENDING', 'FAILED')
          AND COALESCE(scan_next_attempt_at, updated_at)
            <= ${now.toISOString()}::timestamptz)
          OR (scan_status = 'SCANNING'
            AND scan_lease_expires_at <= ${now.toISOString()}::timestamptz)))::int
        AS "retryReady",
      count(*) FILTER (WHERE status = 'QUARANTINED'
        AND retention_status = 'ACTIVE' AND scan_status = 'FAILED'
        AND scan_attempt_count >= ${config.maxAttempts})::int AS "exhausted",
      count(*) FILTER (WHERE status = 'QUARANTINED'
        AND retention_status = 'ACTIVE'
        AND expires_at <= ${now.toISOString()}::timestamptz)::int
        AS "expiredQuarantined",
      EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz
        - min(created_at) FILTER (WHERE status = 'QUARANTINED'
          AND retention_status = 'ACTIVE'
          AND scan_status IN ('PENDING', 'FAILED', 'SCANNING'))))::int
        AS "oldestUnresolvedAgeSeconds"
      FROM dispute_evidence_uploads
  `) as unknown as Array<Record<string, unknown>>;
  const row = rows[0] ?? {};
  const count = (key: string) => Number(row[key] ?? 0);
  return {
    schemaVersion: "dispute-evidence-scan-retry-health-v1" as const,
    status: count("staleProcessing") > 0 || count("exhausted") > 0
      || count("expiredQuarantined") > 0
      ? "attention" as const : "healthy" as const,
    job: {
      enabled: process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB === "true",
      cronEnabled: process.env.ENABLE_CRON === "true",
    },
    scanner: getDisputeEvidenceScannerPolicyStatus(),
    policy: {
      batchSize: config.batchSize,
      maxAttempts: config.maxAttempts,
      leaseSeconds: config.leaseSeconds,
      baseBackoffSeconds: config.baseBackoffSeconds,
      maxBackoffSeconds: config.maxBackoffSeconds,
    },
    totals: {
      quarantined: count("quarantined"),
      pending: count("pending"),
      failed: count("failed"),
      processing: count("processing"),
      staleProcessing: count("staleProcessing"),
      retryReady: count("retryReady"),
      exhausted: count("exhausted"),
      expiredQuarantined: count("expiredQuarantined"),
    },
    oldestUnresolvedAgeSeconds:
      row.oldestUnresolvedAgeSeconds === null
      || row.oldestUnresolvedAgeSeconds === undefined
        ? null
        : Math.max(0, Number(row.oldestUnresolvedAgeSeconds)),
    containsIdentifiers: false,
    containsStoragePaths: false,
    containsLeaseTokens: false,
    observedAt: now.toISOString(),
  };
}

export async function runDisputeEvidenceScanRetry(
  db: Database,
  options: {
    now?: Date;
    retryConfig?: DisputeEvidenceScanRetryConfig;
    scannerConfig?: DisputeEvidenceScannerConfig | null;
    download?: typeof downloadDisputeEvidence;
    scan?: typeof scanDisputeEvidence;
  } = {},
) {
  const now = options.now ?? new Date();
  const retryConfig = options.retryConfig
    ?? resolveDisputeEvidenceScanRetryConfigFromEnv();
  const scannerConfig = options.scannerConfig === undefined
    ? resolveDisputeEvidenceScannerConfigFromEnv()
    : options.scannerConfig;
  if (!scannerConfig) {
    return {
      schemaVersion: "dispute-evidence-scan-retry-run-v1" as const,
      status: "skipped" as const,
      reason: "SCANNER_NOT_CONFIGURED" as const,
      claimed: 0, clean: 0, infected: 0, retryScheduled: 0,
      exhausted: 0, staleFinalizersRejected: 0,
      realNetworkCalled: false,
      storageRead: false,
    };
  }
  const claims = await claimDisputeEvidenceScanRetries(db, {
    now, config: retryConfig,
  });
  const totals = {
    clean: 0, infected: 0, retryScheduled: 0,
    exhausted: 0, staleFinalizersRejected: 0,
  };
  for (const claim of claims) {
    let result: DisputeEvidenceScanResult;
    try {
      const path = validateDisputeStoragePath(
        claim.disputeId,
        claim.storagePath,
      );
      const bytes = await (options.download ?? downloadDisputeEvidence)(
        path,
        claim.fileSizeBytes,
      );
      result = await (options.scan ?? scanDisputeEvidence)({
        bytes,
        contentType: claim.contentType,
        expectedSizeBytes: claim.fileSizeBytes,
        filename: path.split("/").at(-1) ?? "evidence",
      }, { config: scannerConfig, db });
    } catch {
      result = {
        status: "FAILED",
        provider: "haggle-scan-retry",
        detail: "SCAN_RETRY_EXECUTION_FAILED",
      };
    }
    const finalized = await finalizeDisputeEvidenceScanRetry(
      db, claim, result, { now: new Date(), config: retryConfig },
    );
    if (!finalized) {
      totals.staleFinalizersRejected += 1;
    } else if (result.status === "CLEAN") {
      totals.clean += 1;
    } else if (result.status === "INFECTED") {
      totals.infected += 1;
    } else if (claim.attemptCount >= retryConfig.maxAttempts) {
      totals.exhausted += 1;
    } else {
      totals.retryScheduled += 1;
    }
  }
  return {
    schemaVersion: "dispute-evidence-scan-retry-run-v1" as const,
    status: "completed" as const,
    reason: null,
    claimed: claims.length,
    ...totals,
    realNetworkCalled: claims.length > 0 && options.scan === undefined,
    storageRead: claims.length > 0 && options.download === undefined,
  };
}
