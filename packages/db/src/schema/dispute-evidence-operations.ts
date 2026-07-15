import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const disputeEvidenceProvenanceArchiveOutbox = pgTable(
  "dispute_evidence_provenance_archive_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    archiveKey: text("archive_key").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
    disputeId: uuid("dispute_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    status: text("status", {
      enum: ["PENDING", "PROCESSING", "DELIVERED", "FAILED", "DEAD_LETTER"],
    })
      .notNull()
      .default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    httpStatus: integer("http_status"),
    receiptId: text("receipt_id"),
    receiptSha256: text("receipt_sha256"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    archiveKeyUnique: uniqueIndex("dispute_evidence_provenance_archive_key_unique").on(
      table.archiveKey,
    ),
    evidenceIdx: index("dispute_evidence_provenance_archive_evidence_idx").on(
      table.evidenceId,
      table.createdAt,
    ),
    dueIdx: index("dispute_evidence_provenance_archive_due_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    statusCheck: check(
      "dispute_evidence_provenance_archive_status_check",
      sql`${table.status} IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER')`,
    ),
    payloadHashCheck: check(
      "dispute_evidence_provenance_archive_payload_hash_check",
      sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    receiptHashCheck: check(
      "dispute_evidence_provenance_archive_receipt_hash_check",
      sql`${table.receiptSha256} IS NULL OR ${table.receiptSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    payloadSizeCheck: check(
      "dispute_evidence_provenance_archive_payload_size_check",
      sql`octet_length(${table.payload}::text) <= 131072`,
    ),
    deliveryCheck: check(
      "dispute_evidence_provenance_archive_delivery_check",
      sql`(${table.status} = 'DELIVERED' AND ${table.deliveredAt} IS NOT NULL AND ${table.receiptId} IS NOT NULL AND ${table.receiptSha256} = ${table.payloadSha256}) OR (${table.status} <> 'DELIVERED' AND ${table.deliveredAt} IS NULL)`,
    ),
  }),
);

export const disputeEvidenceScannerCircuits = pgTable(
  "dispute_evidence_scanner_circuits",
  {
    circuitKey: varchar("circuit_key", { length: 80 }).primaryKey(),
    state: varchar("state", { length: 16, enum: ["CLOSED", "OPEN", "HALF_OPEN"] })
      .notNull()
      .default("CLOSED"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    nextProbeAt: timestamp("next_probe_at", { withTimezone: true }),
    probeToken: uuid("probe_token"),
    probeExpiresAt: timestamp("probe_expires_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    circuitKeyCheck: check(
      "dispute_evidence_scanner_circuit_key_chk",
      sql`${table.circuitKey} ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'`,
    ),
    stateCheck: check(
      "dispute_evidence_scanner_circuit_state_chk",
      sql`${table.state} IN ('CLOSED', 'OPEN', 'HALF_OPEN')`,
    ),
    failureCheck: check(
      "dispute_evidence_scanner_circuit_failure_chk",
      sql`${table.consecutiveFailures} BETWEEN 0 AND 1000`,
    ),
    shapeCheck: check(
      "dispute_evidence_scanner_circuit_shape_chk",
      sql`(${table.state} = 'CLOSED' AND ${table.nextProbeAt} IS NULL AND ${table.probeToken} IS NULL AND ${table.probeExpiresAt} IS NULL) OR (${table.state} = 'OPEN' AND ${table.nextProbeAt} IS NOT NULL AND ${table.probeToken} IS NULL AND ${table.probeExpiresAt} IS NULL) OR (${table.state} = 'HALF_OPEN' AND ${table.nextProbeAt} IS NULL AND ${table.probeToken} IS NOT NULL AND ${table.probeExpiresAt} IS NOT NULL)`,
    ),
  }),
);

export const disputeEvidenceScannerPermits = pgTable(
  "dispute_evidence_scanner_permits",
  {
    permitId: uuid("permit_id").primaryKey(),
    circuitKey: varchar("circuit_key", { length: 80 }).notNull(),
    permitKind: varchar("permit_kind", { length: 16, enum: ["REGULAR", "PROBE"] }).notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    circuitFk: foreignKey({
      name: "dispute_evidence_scanner_permits_circuit_key_fkey",
      columns: [table.circuitKey],
      foreignColumns: [disputeEvidenceScannerCircuits.circuitKey],
    }).onDelete("cascade"),
    liveIdx: index("dispute_evidence_scanner_permits_live_idx").on(
      table.circuitKey,
      table.expiresAt,
    ),
    kindCheck: check(
      "dispute_evidence_scanner_permit_kind_chk",
      sql`${table.permitKind} IN ('REGULAR', 'PROBE')`,
    ),
    expiryCheck: check(
      "dispute_evidence_scanner_permit_expiry_chk",
      sql`${table.expiresAt} > ${table.acquiredAt} AND ${table.expiresAt} <= ${table.acquiredAt} + interval '5 minutes'`,
    ),
  }),
);

export const disputeEvidenceScanRetryAlertSnapshotRetentionState = pgTable(
  "dispute_evidence_scan_retry_alert_snapshot_retention_state",
  {
    jobKey: text("job_key").primaryKey(),
    status: text("status", { enum: ["NEVER", "RUNNING", "SUCCEEDED", "FAILED"] }).notNull(),
    claimId: uuid("claim_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
    lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    lastDeletedSnapshots: integer("last_deleted_snapshots").notNull().default(0),
    lastFailureCode: text("last_failure_code"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    jobKeyCheck: check(
      "dispute_scan_retry_alert_snapshot_retention_job_key_check",
      sql`${table.jobKey} = 'snapshot_retention'`,
    ),
    statusCheck: check(
      "dispute_scan_retry_alert_snapshot_retention_status_check",
      sql`${table.status} IN ('NEVER', 'RUNNING', 'SUCCEEDED', 'FAILED')`,
    ),
    deletedCheck: check(
      "dispute_scan_retry_alert_snapshot_retention_deleted_check",
      sql`${table.lastDeletedSnapshots} >= 0`,
    ),
    failureCheck: check(
      "dispute_scan_retry_alert_snapshot_retention_failure_check",
      sql`(${table.status} = 'FAILED' AND ${table.lastFailureCode} = 'RETENTION_EXECUTION_FAILED' AND ${table.lastFailedAt} IS NOT NULL) OR (${table.status} <> 'FAILED' AND ${table.lastFailureCode} IS NULL)`,
    ),
    leaseCheck: check(
      "dispute_scan_retry_alert_snapshot_retention_lease_check",
      sql`(${table.status} = 'RUNNING' AND ${table.claimId} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL AND ${table.lastStartedAt} IS NOT NULL) OR (${table.status} <> 'RUNNING' AND ${table.claimId} IS NULL AND ${table.leaseExpiresAt} IS NULL)`,
    ),
    successCheck: check(
      "dispute_scan_retry_alert_snapshot_retention_success_check",
      sql`${table.status} <> 'SUCCEEDED' OR ${table.lastSucceededAt} IS NOT NULL`,
    ),
    neverCheck: check(
      "dispute_scan_retry_alert_snapshot_retention_never_check",
      sql`${table.status} <> 'NEVER' OR (${table.lastStartedAt} IS NULL AND ${table.lastSucceededAt} IS NULL AND ${table.lastFailedAt} IS NULL AND ${table.lastDeletedSnapshots} = 0)`,
    ),
  }),
);
