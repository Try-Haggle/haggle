ALTER TABLE "shipment_apv_invoice_documents"
  ADD COLUMN IF NOT EXISTS "integrity_status" text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "integrity_note" text,
  ADD COLUMN IF NOT EXISTS "integrity_updated_at" timestamptz;

ALTER TABLE "shipment_apv_invoice_documents"
  DROP CONSTRAINT IF EXISTS "shipment_apv_invoice_documents_integrity_status_check";
ALTER TABLE "shipment_apv_invoice_documents"
  ADD CONSTRAINT "shipment_apv_invoice_documents_integrity_status_check"
  CHECK ("integrity_status" IN ('ACTIVE', 'MISSING', 'QUARANTINED'));

CREATE INDEX IF NOT EXISTS "shipment_apv_invoice_documents_integrity_idx"
  ON "shipment_apv_invoice_documents" ("integrity_status", "created_at");

CREATE TABLE IF NOT EXISTS "shipment_apv_invoice_reconciliation_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_request_id" uuid NOT NULL,
  "anomaly_type" text NOT NULL,
  "target_fingerprint" text NOT NULL,
  "storage_key" text NOT NULL,
  "document_id" uuid REFERENCES "shipment_apv_invoice_documents"("id"),
  "expected_sha256" text,
  "expected_byte_size" integer,
  "requester_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "version" integer NOT NULL DEFAULT 0,
  "expires_at" timestamptz NOT NULL,
  "approver_id" uuid,
  "decision_request_id" uuid,
  "decision_reason" text,
  "apply_error" text,
  "decided_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_apv_invoice_reconcile_anomaly_check"
    CHECK ("anomaly_type" IN ('MISSING_FILE', 'SIZE_MISMATCH', 'HASH_MISMATCH', 'ORPHAN_FILE')),
  CONSTRAINT "shipment_apv_invoice_reconcile_fingerprint_check"
    CHECK ("target_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_invoice_reconcile_reason_check"
    CHECK (char_length("reason") BETWEEN 12 AND 500),
  CONSTRAINT "shipment_apv_invoice_reconcile_status_check"
    CHECK ("status" IN ('PENDING', 'APPLYING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT "shipment_apv_invoice_reconcile_target_check" CHECK (
    ("anomaly_type" = 'ORPHAN_FILE' AND "document_id" IS NULL)
    OR ("anomaly_type" <> 'ORPHAN_FILE' AND "document_id" IS NOT NULL)
  ),
  CONSTRAINT "shipment_apv_invoice_reconcile_decision_check" CHECK (
    ("status" = 'PENDING' AND "approver_id" IS NULL AND "decided_at" IS NULL)
    OR ("status" = 'EXPIRED' AND "approver_id" IS NULL AND "decision_reason" IS NOT NULL AND "decided_at" IS NOT NULL)
    OR ("status" = 'APPLYING' AND "approver_id" IS NOT NULL AND "decision_request_id" IS NOT NULL
      AND "decision_reason" IS NOT NULL AND "decided_at" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "approver_id" IS NOT NULL AND "decision_reason" IS NOT NULL AND "decided_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_reconcile_client_unique"
  ON "shipment_apv_invoice_reconciliation_requests" ("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_reconcile_decision_unique"
  ON "shipment_apv_invoice_reconciliation_requests" ("decision_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_reconcile_pending_target_unique"
  ON "shipment_apv_invoice_reconciliation_requests" ("target_fingerprint") WHERE "status" IN ('PENDING', 'APPLYING');
CREATE INDEX IF NOT EXISTS "shipment_apv_invoice_reconcile_pending_idx"
  ON "shipment_apv_invoice_reconciliation_requests" ("status", "expires_at", "created_at");

CREATE TABLE IF NOT EXISTS "shipment_apv_invoice_reconciliation_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "shipment_apv_invoice_reconciliation_requests"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "actor_id" uuid,
  "request_version" integer NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_apv_invoice_reconcile_event_type_check"
    CHECK ("event_type" IN ('REQUESTED', 'APPLYING', 'APPROVED', 'REJECTED', 'EXPIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_reconcile_event_transition_unique"
  ON "shipment_apv_invoice_reconciliation_events" ("request_id", "event_type", "request_version");
CREATE INDEX IF NOT EXISTS "shipment_apv_invoice_reconcile_event_timeline_idx"
  ON "shipment_apv_invoice_reconciliation_events" ("request_id", "created_at", "id");
