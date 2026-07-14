import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shipmentApvInvoiceDocuments } from "./shipment-apv-invoice-documents.js";

export const shipmentApvInvoiceReconciliationRequests = pgTable(
  "shipment_apv_invoice_reconciliation_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientRequestId: uuid("client_request_id").notNull(),
    anomalyType: text("anomaly_type", {
      enum: ["MISSING_FILE", "SIZE_MISMATCH", "HASH_MISMATCH", "ORPHAN_FILE"],
    }).notNull(),
    targetFingerprint: text("target_fingerprint").notNull(),
    storageKey: text("storage_key").notNull(),
    documentId: uuid("document_id").references(() => shipmentApvInvoiceDocuments.id),
    expectedSha256: text("expected_sha256"),
    expectedByteSize: integer("expected_byte_size"),
    requesterId: uuid("requester_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["PENDING", "APPLYING", "APPROVED", "REJECTED", "EXPIRED"] })
      .notNull()
      .default("PENDING"),
    version: integer("version").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approverId: uuid("approver_id"),
    decisionRequestId: uuid("decision_request_id"),
    decisionReason: text("decision_reason"),
    applyError: text("apply_error"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientUnique: uniqueIndex("shipment_apv_invoice_reconcile_client_unique").on(
      table.clientRequestId,
    ),
    decisionUnique: uniqueIndex("shipment_apv_invoice_reconcile_decision_unique").on(
      table.decisionRequestId,
    ),
    pendingTargetUnique: uniqueIndex("shipment_apv_invoice_reconcile_pending_target_unique")
      .on(table.targetFingerprint)
      .where(sql`${table.status} IN ('PENDING', 'APPLYING')`),
    pendingIdx: index("shipment_apv_invoice_reconcile_pending_idx").on(
      table.status,
      table.expiresAt,
      table.createdAt,
    ),
  }),
);

export const shipmentApvInvoiceReconciliationEvents = pgTable(
  "shipment_apv_invoice_reconciliation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => shipmentApvInvoiceReconciliationRequests.id, { onDelete: "cascade" }),
    eventType: text("event_type", {
      enum: ["REQUESTED", "APPLYING", "APPROVED", "REJECTED", "EXPIRED"],
    }).notNull(),
    actorId: uuid("actor_id"),
    requestVersion: integer("request_version").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    transitionUnique: uniqueIndex("shipment_apv_invoice_reconcile_event_transition_unique").on(
      table.requestId,
      table.eventType,
      table.requestVersion,
    ),
    timelineIdx: index("shipment_apv_invoice_reconcile_event_timeline_idx").on(
      table.requestId,
      table.createdAt,
      table.id,
    ),
  }),
);
