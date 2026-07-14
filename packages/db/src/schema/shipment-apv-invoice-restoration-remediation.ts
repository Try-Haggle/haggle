import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { shipmentApvInvoiceRestorationRequests } from "./shipment-apv-invoice-restoration.js";

export const shipmentApvInvoiceRestorationRemediationRequests = pgTable("shipment_apv_invoice_restoration_remediation_requests", {
  id: uuid("id").primaryKey(), clientRequestId: uuid("client_request_id").notNull(),
  candidateFingerprint: text("candidate_fingerprint").notNull(),
  restorationRequestId: uuid("restoration_request_id").notNull().references(() => shipmentApvInvoiceRestorationRequests.id),
  issueType: text("issue_type", { enum: ["SOURCE_MISSING", "HASH_MISMATCH", "DESTINATION_CONFLICT"] }).notNull(),
  observedSha256: text("observed_sha256"), observedByteSize: integer("observed_byte_size"),
  requesterId: uuid("requester_id").notNull(), reason: text("reason").notNull(),
  status: text("status", { enum: ["PENDING", "APPLYING", "APPROVED", "REJECTED", "EXPIRED"] }).notNull().default("PENDING"),
  version: integer("version").notNull().default(0), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  approverId: uuid("approver_id"), decisionRequestId: uuid("decision_request_id"),
  decision: text("decision", { enum: ["APPROVE", "REJECT"] }), decisionReason: text("decision_reason"),
  applyError: text("apply_error"), decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clientUnique: uniqueIndex("shipment_apv_invoice_restore_remediation_client_unique").on(table.clientRequestId),
  decisionUnique: uniqueIndex("shipment_apv_invoice_restore_remediation_decision_unique").on(table.decisionRequestId),
  activeUnique: uniqueIndex("shipment_apv_invoice_restore_remediation_active_unique")
    .on(table.restorationRequestId).where(sql`${table.status} IN ('PENDING', 'APPLYING')`),
  pendingIdx: index("shipment_apv_invoice_restore_remediation_pending_idx").on(table.status, table.expiresAt, table.createdAt),
}));

export const shipmentApvInvoiceRestorationRemediationEvents = pgTable("shipment_apv_invoice_restoration_remediation_events", {
  id: uuid("id").defaultRandom().primaryKey(), requestId: uuid("request_id").notNull()
    .references(() => shipmentApvInvoiceRestorationRemediationRequests.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: ["REQUESTED", "APPLYING", "APPROVED", "REJECTED", "EXPIRED"] }).notNull(),
  actorId: uuid("actor_id"), requestVersion: integer("request_version").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  eventUnique: uniqueIndex("shipment_apv_invoice_restore_remediation_event_unique")
    .on(table.requestId, table.eventType, table.requestVersion),
  timelineIdx: index("shipment_apv_invoice_restore_remediation_event_timeline_idx")
    .on(table.requestId, table.requestVersion, table.createdAt, table.id),
}));

export const shipmentApvInvoiceRestorationRemediationAcknowledgments = pgTable(
  "shipment_apv_invoice_restoration_remediation_acknowledgments", {
    id: uuid("id").primaryKey(), clientRequestId: uuid("client_request_id").notNull(),
    remediationRequestId: uuid("remediation_request_id").notNull()
      .references(() => shipmentApvInvoiceRestorationRemediationRequests.id, { onDelete: "cascade" }),
    checkerId: uuid("checker_id").notNull(), decisionRequestId: uuid("decision_request_id").notNull(),
    requestVersion: integer("request_version").notNull(),
    action: text("action", { enum: ["ACKNOWLEDGED", "INCIDENT_LINKED"] }).notNull(),
    incidentReferenceHash: text("incident_reference_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => ({
    clientUnique: uniqueIndex("shipment_apv_invoice_restore_remediation_ack_client_unique")
      .on(table.clientRequestId),
    actionUnique: uniqueIndex("shipment_apv_invoice_restore_remediation_ack_action_unique")
      .on(table.remediationRequestId, table.checkerId, table.requestVersion, table.action),
    timelineIdx: index("shipment_apv_invoice_restore_remediation_ack_timeline_idx")
      .on(table.remediationRequestId, table.createdAt, table.id),
  }));
