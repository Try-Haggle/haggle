ALTER TABLE "shipment_apv_invoice_restoration_requests"
  DROP CONSTRAINT "shipment_apv_invoice_restore_staging_status_check";
ALTER TABLE "shipment_apv_invoice_restoration_requests"
  ADD CONSTRAINT "shipment_apv_invoice_restore_staging_status_check"
  CHECK ("staging_status" IN ('STAGED', 'MOVING', 'MOVED', 'CONSUMED', 'MISSING', 'CONFLICT_QUARANTINED'));

ALTER TABLE "shipment_apv_invoice_restoration_events"
  DROP CONSTRAINT "shipment_apv_invoice_restore_event_type_check";
ALTER TABLE "shipment_apv_invoice_restoration_events"
  ADD CONSTRAINT "shipment_apv_invoice_restore_event_type_check"
  CHECK ("event_type" IN ('REQUESTED', 'APPLYING', 'RESTORED', 'PRESERVED', 'REJECTED', 'EXPIRED',
    'STAGING_PRESERVED', 'STAGING_REMEDIATED'));

CREATE TABLE IF NOT EXISTS "shipment_apv_invoice_restoration_remediation_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "client_request_id" uuid NOT NULL,
  "candidate_fingerprint" text NOT NULL,
  "restoration_request_id" uuid NOT NULL REFERENCES "shipment_apv_invoice_restoration_requests"("id"),
  "issue_type" text NOT NULL,
  "observed_sha256" text,
  "observed_byte_size" integer,
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
  CONSTRAINT "shipment_apv_invoice_restore_remediation_candidate_check" CHECK ("candidate_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_invoice_restore_remediation_issue_check" CHECK ("issue_type" IN ('SOURCE_MISSING', 'HASH_MISMATCH', 'DESTINATION_CONFLICT')),
  CONSTRAINT "shipment_apv_invoice_restore_remediation_observed_check" CHECK (
    ("issue_type" = 'SOURCE_MISSING' AND "observed_sha256" IS NULL AND "observed_byte_size" IS NULL)
    OR ("issue_type" IN ('HASH_MISMATCH', 'DESTINATION_CONFLICT')
      AND "observed_sha256" ~ '^[0-9a-f]{64}$' AND "observed_byte_size" > 0 AND "observed_byte_size" <= 5242880)
  ),
  CONSTRAINT "shipment_apv_invoice_restore_remediation_reason_check" CHECK (char_length("reason") BETWEEN 12 AND 500),
  CONSTRAINT "shipment_apv_invoice_restore_remediation_status_check" CHECK ("status" IN ('PENDING', 'APPLYING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT "shipment_apv_invoice_restore_remediation_decision_check" CHECK (
    ("status" = 'PENDING' AND "approver_id" IS NULL AND "decision" IS NULL AND "decided_at" IS NULL)
    OR ("status" = 'EXPIRED' AND "approver_id" IS NULL AND "decision_reason" IS NOT NULL AND "decided_at" IS NOT NULL)
    OR ("status" = 'APPLYING' AND "approver_id" IS NOT NULL AND "decision_request_id" IS NOT NULL
      AND "decision" = 'APPROVE' AND "decision_reason" IS NOT NULL AND "decided_at" IS NULL)
    OR ("status" = 'APPROVED' AND "approver_id" IS NOT NULL AND "decision_request_id" IS NOT NULL AND "decision" = 'APPROVE'
      AND "decision_reason" IS NOT NULL AND "decided_at" IS NOT NULL)
    OR ("status" = 'REJECTED' AND "approver_id" IS NOT NULL AND "decision_request_id" IS NOT NULL AND "decision" = 'REJECT'
      AND "decision_reason" IS NOT NULL AND "decided_at" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_remediation_client_unique"
  ON "shipment_apv_invoice_restoration_remediation_requests" ("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_remediation_decision_unique"
  ON "shipment_apv_invoice_restoration_remediation_requests" ("decision_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_remediation_active_unique"
  ON "shipment_apv_invoice_restoration_remediation_requests" ("restoration_request_id") WHERE "status" IN ('PENDING', 'APPLYING');
CREATE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_remediation_pending_idx"
  ON "shipment_apv_invoice_restoration_remediation_requests" ("status", "expires_at", "created_at");

CREATE TABLE IF NOT EXISTS "shipment_apv_invoice_restoration_remediation_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "shipment_apv_invoice_restoration_remediation_requests"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "actor_id" uuid,
  "request_version" integer NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_apv_invoice_restore_remediation_event_type_check" CHECK ("event_type" IN ('REQUESTED', 'APPLYING', 'APPROVED', 'REJECTED', 'EXPIRED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_remediation_event_unique"
  ON "shipment_apv_invoice_restoration_remediation_events" ("request_id", "event_type", "request_version");
CREATE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_remediation_event_timeline_idx"
  ON "shipment_apv_invoice_restoration_remediation_events" ("request_id", "request_version", "created_at", "id");
