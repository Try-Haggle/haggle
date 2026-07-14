import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { shipmentApvInvoiceDocuments } from "./shipment-apv-invoice-documents.js";

export const shipmentApvInvoiceRestorationRequests = pgTable("shipment_apv_invoice_restoration_requests", {
  id: uuid("id").primaryKey(),
  clientRequestId: uuid("client_request_id").notNull(),
  candidateFingerprint: text("candidate_fingerprint").notNull(),
  documentId: uuid("document_id").notNull().references(() => shipmentApvInvoiceDocuments.id),
  sourceIntegrityStatus: text("source_integrity_status", { enum: ["MISSING", "QUARANTINED"] }).notNull(),
  expectedSha256: text("expected_sha256").notNull(),
  expectedByteSize: integer("expected_byte_size").notNull(),
  contentType: text("content_type", { enum: ["application/pdf", "text/csv", "application/json"] }).notNull(),
  stagingKey: text("staging_key").notNull(),
  replacementSha256: text("replacement_sha256").notNull(),
  replacementByteSize: integer("replacement_byte_size").notNull(),
  requesterId: uuid("requester_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["PENDING", "APPLYING", "RESTORED", "PRESERVED", "REJECTED", "EXPIRED"] }).notNull().default("PENDING"),
  version: integer("version").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  approverId: uuid("approver_id"), decisionRequestId: uuid("decision_request_id"),
  decision: text("decision", { enum: ["RESTORE", "PRESERVE", "REJECT"] }),
  decisionReason: text("decision_reason"), applyError: text("apply_error"),
  stagingStatus: text("staging_status", { enum: ["STAGED", "MOVING", "MOVED", "CONSUMED", "MISSING", "CONFLICT_QUARANTINED"] }).notNull().default("STAGED"),
  stagingDisposedAt: timestamp("staging_disposed_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clientUnique: uniqueIndex("shipment_apv_invoice_restore_client_unique").on(table.clientRequestId),
  decisionUnique: uniqueIndex("shipment_apv_invoice_restore_decision_unique").on(table.decisionRequestId),
  activeDocumentUnique: uniqueIndex("shipment_apv_invoice_restore_active_document_unique")
    .on(table.documentId).where(sql`${table.status} IN ('PENDING', 'APPLYING')`),
  pendingIdx: index("shipment_apv_invoice_restore_pending_idx").on(table.status, table.expiresAt, table.createdAt),
  stagingMaintenanceIdx: index("shipment_apv_invoice_restore_staging_maintenance_idx")
    .on(table.stagingStatus, table.status, table.expiresAt, table.createdAt),
}));

export const shipmentApvInvoiceRestorationEvents = pgTable("shipment_apv_invoice_restoration_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull().references(() => shipmentApvInvoiceRestorationRequests.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: ["REQUESTED", "APPLYING", "RESTORED", "PRESERVED", "REJECTED", "EXPIRED", "STAGING_PRESERVED", "STAGING_REMEDIATED"] }).notNull(),
  actorId: uuid("actor_id"), requestVersion: integer("request_version").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  transitionUnique: uniqueIndex("shipment_apv_invoice_restore_event_transition_unique")
    .on(table.requestId, table.eventType, table.requestVersion),
  timelineIdx: index("shipment_apv_invoice_restore_event_timeline_idx")
    .on(table.requestId, table.requestVersion, table.createdAt, table.id),
}));
