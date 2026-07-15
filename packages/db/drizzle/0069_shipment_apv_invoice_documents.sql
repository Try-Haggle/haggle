CREATE TABLE IF NOT EXISTS "shipment_apv_invoice_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "revision_id" uuid NOT NULL REFERENCES "shipment_apv_adjustment_revisions"("id") ON DELETE CASCADE,
  "provider_document_id" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "sha256" text NOT NULL,
  "storage_key" text NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_apv_invoice_documents_content_type_check"
    CHECK ("content_type" IN ('application/pdf', 'text/csv', 'application/json')),
  CONSTRAINT "shipment_apv_invoice_documents_size_check"
    CHECK ("byte_size" > 0 AND "byte_size" <= 5242880),
  CONSTRAINT "shipment_apv_invoice_documents_sha_check"
    CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_documents_revision_unique"
  ON "shipment_apv_invoice_documents" ("revision_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_documents_storage_unique"
  ON "shipment_apv_invoice_documents" ("storage_key");
