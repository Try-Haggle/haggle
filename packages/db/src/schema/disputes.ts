import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const disputeCases = pgTable("dispute_cases", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  status: text("status", {
    enum: [
      "OPEN",
      "UNDER_REVIEW",
      "WAITING_FOR_BUYER",
      "WAITING_FOR_SELLER",
      "RESOLVED_BUYER_FAVOR",
      "RESOLVED_SELLER_FAVOR",
      "PARTIAL_REFUND",
      "CLOSED",
    ],
  })
    .notNull()
    .default("OPEN"),
  openedBy: text("opened_by", { enum: ["buyer", "seller", "system"] }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  resolutionSummary: text("resolution_summary"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  evidenceLegalHold: boolean("evidence_legal_hold").notNull().default(false),
  evidenceLegalHoldReason: text("evidence_legal_hold_reason"),
  evidenceLegalHoldSetBy: text("evidence_legal_hold_set_by"),
  evidenceLegalHoldSetAt: timestamp("evidence_legal_hold_set_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disputeEvidence = pgTable("dispute_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  disputeId: uuid("dispute_id").notNull(),
  submittedBy: text("submitted_by", { enum: ["buyer", "seller", "system"] }).notNull(),
  type: text("type", {
    enum: ["text", "image", "video", "tracking_snapshot", "payment_proof", "other"],
  }).notNull(),
  uri: text("uri"),
  text: text("text"),
  derivedArtifacts:
    jsonb("derived_artifacts").$type<
      Array<{
        id: string;
        kind: string;
        source_evidence_id: string;
        uri?: string;
        text?: string;
        metadata?: Record<string, unknown>;
        created_at?: string;
      }>
    >(),
  sourceContentSha256: text("source_content_sha256"),
  /** F2: sha256 hex content digest for per-item anchor badge foundation. */
  contentHash: text("content_hash"),
  /** F2: HASHED | PENDING_CHAIN | ANCHORED — stamped HASHED at confirm. */
  anchorStatus: text("anchor_status", {
    enum: ["HASHED", "PENDING_CHAIN", "ANCHORED"],
  }),
  derivedArtifactsProvenance: jsonb("derived_artifacts_provenance").$type<
    Record<string, unknown>
  >(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disputeEvidenceUploads = pgTable(
  "dispute_evidence_uploads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    disputeId: uuid("dispute_id").notNull(),
    uploadedBy: text("uploaded_by", { enum: ["buyer", "seller", "system"] }).notNull(),
    evidenceType: text("evidence_type", { enum: ["image", "video"] }).notNull(),
    contentType: text("content_type").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    status: text("status", { enum: ["PENDING", "QUARANTINED", "COMMITTED", "REJECTED", "EXPIRED"] })
      .notNull()
      .default("PENDING"),
    scanStatus: text("scan_status", {
      enum: ["PENDING", "SCANNING", "CLEAN", "INFECTED", "FAILED", "SKIPPED"],
    })
      .notNull()
      .default("PENDING"),
    contentSha256: text("content_sha256"),
    cameraSessionId: text("camera_session_id"),
    captureDeclaredSha256: text("capture_declared_sha256"),
    perceptualHash: text("perceptual_hash"),
    averageHash: text("average_hash"),
    colorHistogram: jsonb("color_histogram").$type<number[]>(),
    similaritySignals: jsonb("similarity_signals").$type<Record<string, unknown>>(),
    similarityStatus: text("similarity_status", {
      enum: ["PENDING", "CLEAR", "REVIEW_REQUIRED", "APPROVED", "REJECTED", "FAILED", "SKIPPED"],
    })
      .notNull()
      .default("PENDING"),
    similarityDistance: integer("similarity_distance"),
    similarityReviewedBy: text("similarity_reviewed_by"),
    similarityReviewedAt: timestamp("similarity_reviewed_at", { withTimezone: true }),
    retentionStatus: text("retention_status", {
      enum: ["ACTIVE", "DELETING", "DELETED", "FAILED"],
    })
      .notNull()
      .default("ACTIVE"),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    deletionClaimId: uuid("deletion_claim_id"),
    deletionClaimedAt: timestamp("deletion_claimed_at", { withTimezone: true }),
    deletionAttempts: integer("deletion_attempts").notNull().default(0),
    deletionNextAttemptAt: timestamp("deletion_next_attempt_at", { withTimezone: true }),
    deletionLastError: text("deletion_last_error"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    scanProvider: text("scan_provider"),
    scanDetail: text("scan_detail"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    scanAttemptCount: integer("scan_attempt_count").notNull().default(0),
    scanNextAttemptAt: timestamp("scan_next_attempt_at", { withTimezone: true }),
    scanLeaseToken: uuid("scan_lease_token"),
    scanLeaseExpiresAt: timestamp("scan_lease_expires_at", { withTimezone: true }),
    scanLastError: text("scan_last_error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    committedEvidenceId: uuid("committed_evidence_id"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueStoragePath: unique("dispute_evidence_uploads_storage_path_unique").on(table.storagePath),
    disputeScanStatusIdx: index("dispute_evidence_uploads_dispute_scan_status_idx").on(
      table.disputeId,
      table.scanStatus,
    ),
    scanRetryReadyIdx: index("dispute_evidence_uploads_scan_retry_ready_idx").on(
      table.scanStatus,
      table.scanNextAttemptAt,
      table.scanLeaseExpiresAt,
    ),
    committedCameraSha256Unique: uniqueIndex(
      "dispute_evidence_uploads_committed_camera_sha256_unique",
    )
      .on(table.contentSha256)
      .where(
        sql`${table.status} = 'COMMITTED' AND ${table.cameraSessionId} IS NOT NULL AND ${table.contentSha256} IS NOT NULL`,
      ),
    similarityStatusIdx: index("dispute_evidence_uploads_similarity_status_idx").on(
      table.similarityStatus,
    ),
    retentionStatusIdx: index("dispute_evidence_uploads_retention_status_idx").on(
      table.retentionStatus,
      table.retentionUntil,
    ),
  }),
);

export const disputeEvidenceSimilarityReviewEvents = pgTable(
  "dispute_evidence_similarity_review_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    uploadId: uuid("upload_id").notNull(),
    disputeId: uuid("dispute_id").notNull(),
    eventType: text("event_type", { enum: ["AUTO_EXPIRED"] }).notNull(),
    actorId: uuid("actor_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    eventHash: text("event_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    transitionUnique: uniqueIndex("dispute_evidence_similarity_review_event_transition_unique").on(
      table.uploadId,
      table.eventType,
    ),
    timelineIdx: index("dispute_evidence_similarity_review_event_timeline_idx").on(
      table.uploadId,
      table.createdAt,
      table.id,
    ),
    eventHashIdx: index("dispute_evidence_similarity_review_event_hash_idx")
      .on(table.eventHash)
      .where(sql`${table.eventHash} IS NOT NULL`),
  }),
);

export const disputeEvidenceSimilarityReviewAuditOutbox = pgTable(
  "dispute_evidence_similarity_review_audit_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    archiveKey: text("archive_key").notNull(),
    eventId: uuid("event_id").notNull(),
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
    archiveKeyUnique: uniqueIndex("dispute_similarity_review_audit_archive_key_unique").on(
      table.archiveKey,
    ),
    eventIdx: index("dispute_similarity_review_audit_event_idx").on(table.eventId, table.createdAt),
    dueIdx: index("dispute_similarity_review_audit_due_idx").on(table.status, table.nextAttemptAt),
  }),
);

export const disputeAiAssessmentEvents = pgTable(
  "dispute_ai_assessment_events",
  {
    id: text("id").primaryKey(),
    disputeId: uuid("dispute_id").notNull(),
    eventType: text("event_type", { enum: ["COMPLETED", "FAILED"] }).notNull(),
    revision: integer("revision"),
    versionId: text("version_id"),
    supersedesAssessmentId: text("supersedes_assessment_id"),
    evidenceSnapshotHash: text("evidence_snapshot_hash").notNull(),
    policyVersion: text("policy_version").notNull(),
    model: text("model"),
    contextHash: text("context_hash").notNull(),
    requestedBy: text("requested_by").notNull(),
    forced: boolean("forced").notNull().default(false),
    reassessmentReason: text("reassessment_reason"),
    previousEventHash: text("previous_event_hash"),
    eventHash: text("event_hash"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("dispute_ai_assessment_events_dispute_created_idx").on(table.disputeId, table.createdAt),
    index("dispute_ai_assessment_events_event_hash_idx").on(table.eventHash),
    unique("dispute_ai_assessment_events_dispute_revision_unique").on(
      table.disputeId,
      table.revision,
    ),
  ],
);

export const disputeAiAuditOutbox = pgTable(
  "dispute_ai_audit_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    archiveKey: text("archive_key").notNull(),
    disputeId: uuid("dispute_id").notNull(),
    eventCount: integer("event_count").notNull(),
    eventsSha256: text("events_sha256").notNull(),
    chainHeadEventHash: text("chain_head_event_hash"),
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
    archiveKeyUnique: uniqueIndex("dispute_ai_audit_archive_key_unique").on(table.archiveKey),
    disputeIdx: index("dispute_ai_audit_dispute_idx").on(table.disputeId, table.createdAt),
    dueIdx: index("dispute_ai_audit_due_idx").on(table.status, table.nextAttemptAt),
  }),
);

export const disputeAiAuditDiscoveryFailures = pgTable(
  "dispute_ai_audit_discovery_failures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    disputeId: uuid("dispute_id").notNull(),
    eventCount: integer("event_count").notNull(),
    failureCode: text("failure_code", {
      enum: [
        "AI_AUDIT_ARCHIVE_TOO_LARGE",
        "AI_AUDIT_CHAIN_INVALID",
        "AI_AUDIT_CHAIN_UNSEALED",
        "AI_AUDIT_ARCHIVE_UNEXPECTED",
      ],
    }).notNull(),
    status: text("status", { enum: ["OPEN", "RETRY_REQUESTED", "RESOLVED"] })
      .notNull()
      .default("OPEN"),
    attemptCount: integer("attempt_count").notNull().default(1),
    firstFailedAt: timestamp("first_failed_at", { withTimezone: true }).notNull().defaultNow(),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionUnique: uniqueIndex("dispute_ai_audit_discovery_failure_version_unique").on(
      table.disputeId,
      table.eventCount,
    ),
    openIdx: index("dispute_ai_audit_discovery_failure_open_idx").on(
      table.status,
      table.lastFailedAt,
    ),
  }),
);

export const disputeAiAssessmentLeases = pgTable(
  "dispute_ai_assessment_leases",
  {
    disputeId: uuid("dispute_id").primaryKey(),
    leaseId: uuid("lease_id").notNull(),
    ownerId: text("owner_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("dispute_ai_assessment_leases_expires_idx").on(table.expiresAt)],
);

export const disputeOperationLeases = pgTable(
  "dispute_operation_leases",
  {
    key: text("key").primaryKey(),
    disputeId: uuid("dispute_id").notNull(),
    operation: text("operation").notNull(),
    leaseId: uuid("lease_id").notNull(),
    ownerId: text("owner_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("dispute_operation_leases_expires_idx").on(table.expiresAt)],
);

export const disputeModuleIdempotencyKeys = pgTable(
  "dispute_module_idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    platformId: text("platform_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    disputeId: uuid("dispute_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniquePlatformIdempotencyKey: unique("dispute_module_idem_platform_key_unique").on(
      table.platformId,
      table.idempotencyKey,
    ),
  }),
);

export const disputeModuleWebhookOutbox = pgTable(
  "dispute_module_webhook_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: text("event_id").notNull(),
    platformId: text("platform_id").notNull(),
    externalOrderId: text("external_order_id").notNull(),
    disputeId: uuid("dispute_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", {
      enum: ["PENDING", "PROCESSING", "DELIVERED", "FAILED", "DEAD_LETTER"],
    })
      .notNull()
      .default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueEventId: unique("dispute_module_webhook_outbox_event_id_unique").on(table.eventId),
  }),
);

export const disputeResolutions = pgTable("dispute_resolutions", {
  id: uuid("id").defaultRandom().primaryKey(),
  disputeId: uuid("dispute_id").notNull(),
  outcome: text("outcome", {
    enum: ["buyer_favor", "seller_favor", "partial_refund", "no_action"],
  }).notNull(),
  summary: text("summary").notNull(),
  refundAmountMinor: numeric("refund_amount_minor", { precision: 18, scale: 0 }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
