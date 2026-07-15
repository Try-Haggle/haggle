CREATE TABLE IF NOT EXISTS "shipment_apv_invoice_restoration_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "client_request_id" uuid NOT NULL,
  "candidate_fingerprint" text NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "shipment_apv_invoice_documents"("id"),
  "source_integrity_status" text NOT NULL,
  "expected_sha256" text NOT NULL,
  "expected_byte_size" integer NOT NULL,
  "content_type" text NOT NULL,
  "staging_key" text NOT NULL,
  "replacement_sha256" text NOT NULL,
  "replacement_byte_size" integer NOT NULL,
  "requester_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "version" integer NOT NULL DEFAULT 0,
  "expires_at" timestamptz NOT NULL,
  "approver_id" uuid,
  "decision_request_id" uuid,
  "decision" text,
  "decision_reason" text,
  "apply_error" text,
  "decided_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_apv_invoice_restore_candidate_check"
    CHECK ("candidate_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_invoice_restore_source_status_check"
    CHECK ("source_integrity_status" IN ('MISSING', 'QUARANTINED')),
  CONSTRAINT "shipment_apv_invoice_restore_hash_check"
    CHECK ("expected_sha256" ~ '^[0-9a-f]{64}$' AND "replacement_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_invoice_restore_size_check"
    CHECK ("expected_byte_size" > 0 AND "replacement_byte_size" > 0 AND "replacement_byte_size" <= 5242880),
  CONSTRAINT "shipment_apv_invoice_restore_content_type_check"
    CHECK ("content_type" IN ('application/pdf', 'text/csv', 'application/json')),
  CONSTRAINT "shipment_apv_invoice_restore_reason_check"
    CHECK (char_length("reason") BETWEEN 12 AND 500),
  CONSTRAINT "shipment_apv_invoice_restore_status_check"
    CHECK ("status" IN ('PENDING', 'APPLYING', 'RESTORED', 'PRESERVED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT "shipment_apv_invoice_restore_decision_check" CHECK (
    ("status" = 'PENDING' AND "approver_id" IS NULL AND "decision" IS NULL AND "decided_at" IS NULL)
    OR ("status" = 'EXPIRED' AND "approver_id" IS NULL AND "decision_reason" IS NOT NULL AND "decided_at" IS NOT NULL)
    OR ("status" = 'APPLYING' AND "approver_id" IS NOT NULL AND "decision_request_id" IS NOT NULL
      AND "decision" IN ('RESTORE', 'PRESERVE') AND "decision_reason" IS NOT NULL AND "decided_at" IS NULL)
    OR ("status" IN ('RESTORED', 'PRESERVED') AND "approver_id" IS NOT NULL
      AND "decision" IN ('RESTORE', 'PRESERVE') AND "decision_reason" IS NOT NULL AND "decided_at" IS NOT NULL)
    OR ("status" = 'REJECTED' AND "approver_id" IS NOT NULL AND "decision" = 'REJECT'
      AND "decision_reason" IS NOT NULL AND "decided_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_client_unique"
  ON "shipment_apv_invoice_restoration_requests" ("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_decision_unique"
  ON "shipment_apv_invoice_restoration_requests" ("decision_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_active_document_unique"
  ON "shipment_apv_invoice_restoration_requests" ("document_id") WHERE "status" IN ('PENDING', 'APPLYING');
CREATE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_pending_idx"
  ON "shipment_apv_invoice_restoration_requests" ("status", "expires_at", "created_at");

CREATE TABLE IF NOT EXISTS "shipment_apv_invoice_restoration_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "shipment_apv_invoice_restoration_requests"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "actor_id" uuid,
  "request_version" integer NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_apv_invoice_restore_event_type_check"
    CHECK ("event_type" IN ('REQUESTED', 'APPLYING', 'RESTORED', 'PRESERVED', 'REJECTED', 'EXPIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_event_transition_unique"
  ON "shipment_apv_invoice_restoration_events" ("request_id", "event_type", "request_version");
CREATE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_event_timeline_idx"
  ON "shipment_apv_invoice_restoration_events" ("request_id", "request_version", "created_at", "id");
