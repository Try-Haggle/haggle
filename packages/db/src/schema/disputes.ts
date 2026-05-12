import { integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disputeEvidence = pgTable("dispute_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  disputeId: uuid("dispute_id").notNull(),
  submittedBy: text("submitted_by", { enum: ["buyer", "seller", "system"] }).notNull(),
  type: text("type", { enum: ["text", "image", "video", "tracking_snapshot", "payment_proof", "other"] }).notNull(),
  uri: text("uri"),
  text: text("text"),
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
    status: text("status", { enum: ["PENDING", "COMMITTED", "EXPIRED"] }).notNull().default("PENDING"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    committedEvidenceId: uuid("committed_evidence_id"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueStoragePath: unique("dispute_evidence_uploads_storage_path_unique").on(table.storagePath),
  }),
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
    status: text("status", { enum: ["PENDING", "PROCESSING", "DELIVERED", "FAILED", "DEAD_LETTER"] })
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
