import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { shipmentApvAdjustmentRevisions } from "./shipments.js";

export const shipmentApvInvoiceDocuments = pgTable(
  "shipment_apv_invoice_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    revisionId: uuid("revision_id").notNull()
      .references(() => shipmentApvAdjustmentRevisions.id, { onDelete: "cascade" }),
    providerDocumentId: text("provider_document_id").notNull(),
    contentType: text("content_type", { enum: ["application/pdf", "text/csv", "application/json"] }).notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    integrityStatus: text("integrity_status", { enum: ["ACTIVE", "MISSING", "QUARANTINED"] }).notNull().default("ACTIVE"),
    integrityNote: text("integrity_note"),
    integrityUpdatedAt: timestamp("integrity_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    revisionUnique: uniqueIndex("shipment_apv_invoice_documents_revision_unique").on(table.revisionId),
    storageUnique: uniqueIndex("shipment_apv_invoice_documents_storage_unique").on(table.storageKey),
    createdIdx: index("shipment_apv_invoice_documents_created_idx").on(table.createdAt),
    integrityIdx: index("shipment_apv_invoice_documents_integrity_idx").on(table.integrityStatus, table.createdAt),
  }),
);
